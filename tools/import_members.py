#!/usr/bin/env python3
"""
RWB App: turn the join-form responses sheet (downloaded as CSV) into a clean file
for Supabase > Table Editor > members > Insert > Import data from CSV.

    python3 tools/import_members.py RWB_Contact.csv members_import.csv

- WhatsApp numbers are cut to the last 10 digits; rows without a valid number are skipped.
- If the same number appears twice, the latest form response wins.
- Dates of birth dd/mm/yyyy become yyyy-mm-dd. If the year is clearly wrong, the day and month
  are kept with the year 1904 (meaning "year unknown").
The output holds personal data: keep it private and delete it after importing.
"""
import csv, re, sys
from datetime import datetime

COLS = ['full_name', 'dob', 'phone', 'email', 'vrn', 'bike', 'blood_group',
        'locality', 'hideout', 'emergency_phone', 'alt_phone', 'joined_at']


def digits10(v):
    d = re.sub(r'\D', '', v or '')
    return d[-10:] if len(d) >= 10 else ''


def phone_or_text(v):
    v = (v or '').strip()
    return digits10(v) or v


def date_ddmmyyyy(v):
    v = (v or '').strip()
    for fmt in ('%d/%m/%Y', '%d-%m-%Y', '%d.%m.%Y', '%Y-%m-%d'):
        try:
            d = datetime.strptime(v, fmt).date()
            if 1930 <= d.year <= datetime.now().year - 10:
                return d.isoformat()
            # Wrong year picked in the form (e.g. 2025): keep the day and month for birthday wishes.
            # 1904 marks "year unknown" (a leap year, so 29 Feb still works). The app never shows the year.
            return d.replace(year=1904).isoformat()
        except ValueError:
            pass
    return ''


def timestamp(v):
    try:
        return datetime.strptime((v or '').strip(), '%d/%m/%Y %H:%M:%S').strftime('%Y-%m-%d %H:%M:%S+05:30')
    except ValueError:
        return ''


def bike(v):
    v = (v or '').strip()
    return 'TVS Ronin 225' if v.lower().startswith(('yeah', 'yes')) else v


def clean(v):
    return re.sub(r'\s+', ' ', (v or '')).strip()


def main(src, dst):
    rows = list(csv.DictReader(open(src, encoding='utf-8-sig')))
    out, skipped, bad_dob = {}, [], 0
    for i, r in enumerate(rows, start=2):
        phone = digits10(r.get('WhatsApp No.'))
        name = clean(r.get('Full Name'))
        if not phone or not name:
            skipped.append(i)
            continue
        dob = date_ddmmyyyy(r.get('Date of Birth'))
        bad_dob += 0 if dob or not clean(r.get('Date of Birth')) else 1
        rec = {
            'full_name': name, 'dob': dob, 'phone': phone,
            'email': clean(r.get('Email address')).lower(),
            'vrn': clean(r.get('VRN please')).upper(),
            'bike': bike(r.get('Do you own a Ronin bike?')),
            'blood_group': clean(r.get('Blood group')),
            'locality': clean(r.get('Current Locality')),
            'hideout': clean(r.get('Permanent Hideout')),
            'emergency_phone': phone_or_text(r.get('In case of emergency, contact (number)')),
            'alt_phone': phone_or_text(r.get('Mobile No. (alternative)')),
            'joined_at': timestamp(r.get('Timestamp')),
        }
        old = out.get(phone)
        if not old or rec['joined_at'] >= old['joined_at']:
            out[phone] = rec
    with open(dst, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        w.writeheader()
        w.writerows(out.values())
    print(f'{len(rows)} rows read, {len(out)} members written to {dst}')
    print(f'{len(rows) - len(out) - len(skipped)} duplicate numbers merged, {len(skipped)} rows skipped (no name or number): {skipped}')
    print(f'{sum(1 for r in out.values() if r["email"])} have an email (these sign in instantly), '
          f'{sum(1 for r in out.values() if r["dob"])} have a birthday, {bad_dob} birthdays could not be read')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
