/* RWB App settings.
   1) Paste your Supabase project URL and "anon public" key below (Supabase > Project Settings > API).
      Both are safe to publish: the database rules decide who can see what.
   2) Leave them empty to run the app in demo mode (sample data, stored only on this device). */
const APP_CONFIG = {
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',

    /* Shown in the Service record form. Add or rename freely. */
    SERVICE_ITEMS: [
        'Engine oil change', 'Oil filter', 'Air filter', 'Spark plug',
        'Front brake pads', 'Rear brake pads', 'Brake shoe', 'Brake fluid',
        'Chain clean & lube', 'Chain adjustment', 'Chain sprocket kit',
        'Clutch adjustment', 'Clutch plates', 'Clutch cable', 'Accelerator cable',
        'Throttle body cleaning', 'Valve clearance', 'Battery',
        'Front tyre', 'Rear tyre', 'Wheel balancing', 'Fork oil', 'Fork seals',
        'Bulbs / lights', 'Electrical check', 'ECU / software update',
        'General check-up', 'Wash & polish'
    ],

    /* Message used for birthday wishes. {names} is replaced with the birthday riders' names. */
    BIRTHDAY_WISH: '🎂 Happy Birthday {names}! 🏍️\n\nWishing you many more miles of open roads, safe rides and endless adventures. Have a great one!\n\n— Ronin Warriors of Bengal 🧡'
};
