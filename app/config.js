/* RWB App settings.
   1) Paste your Supabase project URL and "anon public" key below (Supabase > Project Settings > API).
      Both are safe to publish: the database rules decide who can see what.
   2) Leave them empty to run the app in demo mode (sample data, stored only on this device). */
const APP_CONFIG = {
    SUPABASE_URL: 'https://hcowcybshljgkeixudry.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhjb3djeWJzaGxqZ2tlaXh1ZHJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NDI2MjMsImV4cCI6MjEwODMxODYyM30.LLYjaairRQZ3-Ddwo9kschTeVXjEv84n45RrqEUhi0g',

    /* Public key for push notifications (safe to publish; the private half lives only in the database) */
    VAPID_PUBLIC_KEY: 'BEoWMKShMPZthuoPUr7VZKT7Ig6F3-W5WSwAjCbkGkeXrFB8WXpXZRZDTcoE4omiwn20Gqa9Gg59zaQJbSOadmI',

    /* Motomart categories, shown in the sell form and as filters */
    MOTOMART_CATEGORIES: ['Helmet', 'Riding jacket', 'Riding pants', 'Riding shoes / boots', 'Gloves', 'Bike protection',
        'Bike accessories', 'Rider accessories', 'Luggage', 'Electronics', 'Spare parts', 'Other'],

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
