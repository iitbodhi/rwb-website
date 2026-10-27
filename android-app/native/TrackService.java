package in.roninwb.twa;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * RWB Track: shares the rider's live location from a foreground service, so it keeps going with the screen off
 * and the app in the background. Positions go straight to Supabase (track_ping_key) with a sharing key that only
 * works while this rider is sharing. Stops by itself when the time is up or the server says sharing has stopped.
 */
public class TrackService extends Service implements LocationListener {
    static final String PREFS = "rwb_track";
    static final String CHANNEL = "rwb_track";
    static final int NOTIFICATION_ID = 7301;
    static volatile boolean running = false;

    private LocationManager lm;
    private PowerManager.WakeLock wakeLock;
    private Handler handler;
    private final ExecutorService net = Executors.newSingleThreadExecutor();
    private volatile Location last, sent;
    private volatile long sentAt = 0;
    private volatile boolean sending = false;
    private String url, anon, key;
    private long until;

    public static void start(Context c, String url, String anon, String key, long until) {
        c.getSharedPreferences(PREFS, 0).edit().putString("url", url).putString("anon", anon).putString("key", key).putLong("until", until).apply();
        Intent i = new Intent(c, TrackService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }

    public static void stop(Context c) {
        c.getSharedPreferences(PREFS, 0).edit().clear().apply();
        c.stopService(new Intent(c, TrackService.class));
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences p = getSharedPreferences(PREFS, 0);
        url = p.getString("url", null); anon = p.getString("anon", null); key = p.getString("key", null); until = p.getLong("until", 0);
        if (!showNotification()) return START_NOT_STICKY;
        if (url == null || anon == null || key == null || until < System.currentTimeMillis()) { finish(); return START_NOT_STICKY; }
        if (!running) { running = true; begin(); }
        return START_STICKY;
    }

    private boolean showNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Live location (Track)", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        int icon = getResources().getIdentifier("ic_stat_rwb", "drawable", getPackageName());
        if (icon == 0) icon = getApplicationInfo().icon;
        b.setSmallIcon(icon).setContentTitle("RWB is sharing your live location")
            .setContentText("Tap to open the RWB App. Stop sharing in Track.").setOngoing(true).setContentIntent(pi);
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, b.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            else startForeground(NOTIFICATION_ID, b.build());
            return true;
        } catch (Exception e) {   /* e.g. location permission missing: nothing we can do from here */
            stopSelf();
            return false;
        }
    }

    @SuppressLint({"MissingPermission", "WakelockTimeout"})
    private void begin() {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "rwb:track");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire(Math.max(60000L, until - System.currentTimeMillis() + 60000L));
        lm = (LocationManager) getSystemService(LOCATION_SERVICE);
        handler = new Handler(Looper.getMainLooper());
        try { lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 5000L, 0f, this, Looper.getMainLooper()); } catch (Exception ignored) { }
        try { lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 20000L, 0f, this, Looper.getMainLooper()); } catch (Exception ignored) { }
        try { Location l = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER); if (l != null && System.currentTimeMillis() - l.getTime() < 120000L) last = l; } catch (Exception ignored) { }
        handler.postDelayed(tick, 15000L);
    }

    /* heartbeat: the time limit, and a position at least every minute (also when standing still or after a failed send) */
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (System.currentTimeMillis() > until) { finish(); return; }
            Location l = last;
            if (l != null && System.currentTimeMillis() - sentAt >= 60000L) send(l);
            handler.postDelayed(this, 15000L);
        }
    };

    @Override public void onLocationChanged(Location l) {
        Location prev = last;
        /* a rough network fix doesn't replace a recent GPS fix */
        if (LocationManager.NETWORK_PROVIDER.equals(l.getProvider()) && prev != null && LocationManager.GPS_PROVIDER.equals(prev.getProvider())
            && l.getTime() - prev.getTime() < 60000L) return;
        last = l;
        long now = System.currentTimeMillis(), gap = now - sentAt;
        float moved = sent == null ? Float.MAX_VALUE : sent.distanceTo(l);
        long every = l.hasSpeed() && l.getSpeed() > 8 ? 10000L : 20000L;
        if ((moved >= 30 && gap >= every) || gap >= 60000L || (sent == null && l.getAccuracy() <= 100)) send(l);
    }
    @Override public void onProviderEnabled(String provider) { }
    @Override public void onProviderDisabled(String provider) { }
    @Override public void onStatusChanged(String provider, int status, Bundle extras) { }

    private void send(final Location l) {
        if (sending) return;
        sending = true; sent = l; sentAt = System.currentTimeMillis();
        net.execute(() -> {
            try {
                JSONObject o = new JSONObject();
                o.put("p_key", key); o.put("p_lat", l.getLatitude()); o.put("p_lng", l.getLongitude());
                o.put("p_acc", l.hasAccuracy() ? (double) Math.round(l.getAccuracy()) : JSONObject.NULL);
                o.put("p_spd", l.hasSpeed() ? (double) l.getSpeed() : JSONObject.NULL);
                o.put("p_hdg", l.hasBearing() ? (double) l.getBearing() : JSONObject.NULL);
                HttpURLConnection c = (HttpURLConnection) new URL(url + "/rest/v1/rpc/track_ping_key").openConnection();
                c.setRequestMethod("POST"); c.setConnectTimeout(15000); c.setReadTimeout(15000); c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                c.setRequestProperty("apikey", anon); c.setRequestProperty("Authorization", "Bearer " + anon);
                try (OutputStream os = c.getOutputStream()) { os.write(o.toString().getBytes(StandardCharsets.UTF_8)); }
                int code = c.getResponseCode();
                StringBuilder sb = new StringBuilder();
                InputStream is = code < 400 ? c.getInputStream() : c.getErrorStream();
                if (is != null) {
                    try (BufferedReader r = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) { String s; while ((s = r.readLine()) != null) sb.append(s); }
                }
                c.disconnect();
                if (code < 300 && sb.toString().contains("stopped")) handler.post(this::finish);
                else if (code >= 300) sentAt = 0;   /* try again on the next tick */
            } catch (Exception e) {
                sentAt = 0;                          /* no signal: try again on the next tick */
            } finally {
                sending = false;
            }
        });
    }

    private void finish() {
        running = false;
        getSharedPreferences(PREFS, 0).edit().clear().apply();
        cleanup();
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
        stopSelf();
    }

    private void cleanup() {
        try { if (lm != null) lm.removeUpdates(this); } catch (Exception ignored) { }
        if (handler != null) handler.removeCallbacksAndMessages(null);
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    }

    @Override public void onDestroy() {
        running = false;
        cleanup();
        net.shutdownNow();
        super.onDestroy();
    }
}
