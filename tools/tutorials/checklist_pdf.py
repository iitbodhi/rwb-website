"""Makes assets/checklist.pdf: the sample guide PDF shown in the Guides & Pookie video (the demo app has no real PDFs)."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from rec import S
F = os.path.expanduser('~/.fonts')
pdfmetrics.registerFont(TTFont('BC', f'{F}/BarlowCondensed-ExtraBold.ttf')); pdfmetrics.registerFont(TTFont('B', f'{F}/Barlow-Regular.ttf')); pdfmetrics.registerFont(TTFont('BS', f'{F}/Barlow-SemiBold.ttf'))
c = canvas.Canvas(f'{S}/assets/checklist.pdf', pagesize=A4); W, H = A4
c.setFillColor(HexColor('#1b1715')); c.rect(0, H - 150, W, 150, fill=1, stroke=0)
c.setFillColor(HexColor('#e8662e')); c.rect(40, H - 128, 70, 6, fill=1, stroke=0)
c.setFillColor(HexColor('#ffffff')); c.setFont('BC', 40); c.drawString(40, H - 95, 'FIRST FREE SERVICE'); c.setFont('BS', 16); c.setFillColor(HexColor('#d8d2cb')); c.drawString(40, H - 60, 'RWB MAINTENANCE GUIDE')
c.setFillColor(HexColor('#333333')); c.setFont('B', 14); c.drawString(40, H - 190, 'At about 750 to 1,000 km. Ask the service centre to check:')
y = H - 235
for t in ['Engine oil and oil filter', 'Chain slack, cleaning and lube', 'Front and rear brakes', 'Tyre pressure and tyre condition', 'Clutch and throttle play',
          'Battery and wiring', 'Lights, horn and indicators', 'Nuts and bolts tightened', 'A short test ride with you']:
    c.setFillColor(HexColor('#fdf1ea')); c.roundRect(40, y - 14, W - 80, 38, 8, fill=1, stroke=0)
    c.setStrokeColor(HexColor('#e8662e')); c.setLineWidth(2); c.rect(54, y - 4, 16, 16, fill=0)
    c.setFillColor(HexColor('#222222')); c.setFont('BS', 15); c.drawString(84, y, t); y -= 48
c.setFont('B', 12); c.setFillColor(HexColor('#777777')); c.drawString(40, 60, 'Keep your bill. Log it in the RWB App: Service → Add service.')
c.showPage(); c.save()
