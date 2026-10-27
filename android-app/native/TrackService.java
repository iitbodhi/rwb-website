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
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.PowerManager;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * RWB Track: live location the way WhatsApp live location shares it, tuned for battery.
 *
 * Staying alive
 * - A foreground service of type "location" with an ongoing notification (and a Stop button). Android keeps it running
 *   with the screen off, with the app minimised, and after the app is swiped away from recent apps.
 * - It never depends on the app screen: everything runs on the service's own thread.
 * - If Android ever stops it, it asks to be restarted (START_REDELIVER_INTENT) and the app restarts it when opened.
 *
 * Battery
 * - Google's fused location: GPS + Wi-Fi + mobile network, with three speeds:
 *     riding  (moving fast): high accuracy, a fix every ~8 s, at most a send every 15 s
 *     moving slowly         : balanced, every ~20 s, a send every 30 s
 *     stopped (3 min)       : low power, every ~60 s, a heartbeat send every 90 s
 * - Sends reuse one connection (no new HTTPS handshake each time) and only a few hundred bytes.
 * - No permanent wake lock: the CPU is kept awake only for the second it takes to send.
 */
public class TrackService extends Service {
    static final String PREFS = "rwb_track", STATS = "rwb_track_stats";
    static final String CHANNEL = "rwb_track";
    static final String ACTION_STOP = "in.roninwb.twa.TRACK_STOP";
    static final int NOTIFICATION_ID = 7301;
    static volatile boolean running = false;

    private static final int RIDING = 2, MOVING = 1, STILL = 0;
    private HandlerThread thread;
    private Handler handler;
    private PowerManager.WakeLock sendLock;
    private FusedLocationProviderClient fused;
    private LocationManager lm;
    private int mode = -1;
    private Location last, sent, anchor;
    private long sentAt = 0, anchorAt = 0;
    private boolean sending = false;
    private String url, anon, key;
    private long until;

    public static void start(Context c, String url, String anon, String key, long until) {
        c.getSharedPreferences(PREFS, 0).edit().putString("url", url).putString("anon", anon).putString("key", key).putLong("until", until).apply();
        c.getSharedPreferences(STATS, 0).edit().clear().putLong("started", System.currentTimeMillis()).apply();
        Intent i = new Intent(c, TrackService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }

    public static void stop(Context c) {
        c.getSharedPreferences(PREFS, 0).edit().clear().apply();
        c.stopService(new Intent(c, TrackService.class));
    }

    private void stat(String k, long v) { getSharedPreferences(STATS, 0).edit().putLong(k, v).apply(); }
    private void stat(String k, String v) { getSharedPreferences(STATS, 0).edit().putString(k, v).apply(); }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences p = getSharedPreferences(PREFS, 0);
        url = p.getString("url", null); anon = p.getString("anon", null); key = p.getString("key", null); until = p.getLong("until", 0);
        if (intent != null && ACTION_STOP.equals(intent.getAction())) { stopFromNotification(); return START_NOT_STICKY; }
        if (!showNotification()) return START_NOT_STICKY;
        if (url == null || anon == null || key == null || until < System.currentTimeMillis()) { finish("time up"); return START_NOT_STICKY; }
        if (!running) { running = true; begin(); }
        return START_REDELIVER_INTENT;
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
        PendingIntent stopPi = PendingIntent.getService(this, 1, new Intent(this, TrackService.class).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        int icon = getResources().getIdentifier("ic_stat_rwb", "drawable", getPackageName());
        if (icon == 0) icon = getApplicationInfo().icon;
        b.setSmallIcon(icon).setContentTitle("RWB is sharing your live location")
            .setContentText("Tap to open the RWB App").setOngoing(true).setContentIntent(pi)
            .addAction(new Notification.Action.Builder(0, "Stop sharing", stopPi).build());
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, b.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            else startForeground(NOTIFICATION_ID, b.build());
            return true;
        } catch (Exception e) {   /* e.g. no location permission, or Android refused a restart from the background */
            stat("error", "start: " + e.getClass().getSimpleName() + " " + e.getMessage());
            running = false;
            stopSelf();
            return false;
        }
    }

    private void begin() {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        sendLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "rwb:track-send");
        sendLock.setReferenceCounted(false);
        thread = new HandlerThread("rwb-track");
        thread.start();
        handler = new Handler(thread.getLooper());
        handler.post(() -> { setMode(MOVING); handler.postDelayed(tick, 30000L); });
    }

    /* one location request per mode: the slower, the less battery */
    @SuppressLint("MissingPermission")
    private void setMode(int m) {
        if (m == mode) return;
        mode = m;
        long interval = m == RIDING ? 8000L : m == MOVING ? 20000L : 60000L;
        int priority = m == RIDING ? Priority.PRIORITY_HIGH_ACCURACY : m == MOVING ? Priority.PRIORITY_BALANCED_POWER_ACCURACY : Priority.PRIORITY_LOW_POWER;
        try {
            if (fused == null) fused = LocationServices.getFusedLocationProviderClient(this);
            fused.removeLocationUpdates(fusedCb);
            LocationRequest req = new LocationRequest.Builder(priority, interval)
                .setMinUpdateIntervalMillis(interval / 2).setMinUpdateDistanceMeters(m == STILL ? 0f : 10f)
                .setWaitForAccurateLocation(false).build();
            fused.requestLocationUpdates(req, fusedCb, thread.getLooper());
            stat("provider", m == RIDING ? "riding" : m == MOVING ? "moving" : "stopped");
        } catch (Throwable t) {   /* no Google Play services: the phone's GPS directly */
            try {
                if (lm == null) lm = (LocationManager) getSystemService(LOCATION_SERVICE);
                lm.removeUpdates(gpsCb);
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, interval, m == STILL ? 0f : 10f, gpsCb, thread.getLooper());
                try { lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 60000L, 0f, gpsCb, thread.getLooper()); } catch (Exception ignored) { }
                stat("provider", "gps");
            } catch (Exception e) { stat("error", "location: " + e.getMessage()); }
        }
    }

    private final LocationCallback fusedCb = new LocationCallback() {
        @Override public void onLocationResult(LocationResult r) { Location l = r.getLastLocation(); if (l != null) onFix(l); }
    };
    private final LocationListener gpsCb = new LocationListener() {
        @Override public void onLocationChanged(Location l) { onFix(l); }
        @Override public void onProviderEnabled(String p) { }
        @Override public void onProviderDisabled(String p) { }
        @Override public void onStatusChanged(String p, int s, Bundle b) { }
    };

    /* the service's own thread */
    private void onFix(Location l) {
        if (last != null && "network".equals(l.getProvider()) && "gps".equals(last.getProvider()) && l.getTime() - last.getTime() < 60000L) return;
        last = l;
        long now = System.currentTimeMillis();
        getSharedPreferences(STATS, 0).edit().putLong("fix", now).putLong("acc", (long) l.getAccuracy())
            .putString("lat", String.valueOf(l.getLatitude())).putString("lng", String.valueOf(l.getLongitude())).apply();
        /* riding, moving slowly or stopped */
        float speed = l.hasSpeed() ? l.getSpeed() : 0f;
        if (anchor == null || anchor.distanceTo(l) > 50) { anchor = l; anchorAt = now; }
        int want = speed > 5f ? RIDING : now - anchorAt < 180000L ? MOVING : STILL;
        setMode(want);
        long gap = now - sentAt, every = want == RIDING ? 15000L : want == MOVING ? 30000L : 90000L;
        float moved = sent == null ? Float.MAX_VALUE : sent.distanceTo(l);
        if (sent == null || (moved >= 25 && gap >= every) || gap >= 90000L) send(l);
    }

    /* heartbeat (every 30 s): the time limit, a position at least every 90 s, and retries after no signal */
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (System.currentTimeMillis() > until) { finish("time up"); return; }
            if (last != null && System.currentTimeMillis() - sentAt >= 90000L) send(last);
            handler.postDelayed(this, 30000L);
        }
    };

    private void send(Location l) {
        if (sending) return;
        sending = true; sent = l; sentAt = System.currentTimeMillis();
        sendLock.acquire(20000L);   /* only while sending */
        try {
            JSONObject o = new JSONObject();
            o.put("p_key", key); o.put("p_lat", l.getLatitude()); o.put("p_lng", l.getLongitude());
            o.put("p_acc", l.hasAccuracy() ? (double) Math.round(l.getAccuracy()) : JSONObject.NULL);
            o.put("p_spd", l.hasSpeed() ? (double) l.getSpeed() : JSONObject.NULL);
            o.put("p_hdg", l.hasBearing() ? (double) l.getBearing() : JSONObject.NULL);
            String[] r = post("track_ping_key", o);
            int code = Integer.parseInt(r[0]);
            stat("code", code);
            if (code > 0 && code < 300) {
                stat("sent", System.currentTimeMillis()); stat("error", "");
                if (r[1].contains("stopped")) finish("stopped");
            } else { stat("error", code == 0 ? "no internet (will retry)" : "server " + code + ": " + r[1]); sentAt = 0; }
        } catch (Exception e) {
            stat("error", "no internet (will retry)"); sentAt = 0;
        } finally {
            sending = false;
            if (sendLock.isHeld()) sendLock.release();
        }
    }

    /* POST to a Supabase function. Keeps the connection open for the next send (no disconnect). */
    private String[] post(String fn, JSONObject body) {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(url + "/rest/v1/rpc/" + fn).openConnection();
            c.setRequestMethod("POST"); c.setConnectTimeout(12000); c.setReadTimeout(12000); c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("apikey", anon); c.setRequestProperty("Authorization", "Bearer " + anon);
            try (OutputStream os = c.getOutputStream()) { os.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
            int code = c.getResponseCode();
            StringBuilder sb = new StringBuilder();
            InputStream is = code < 400 ? c.getInputStream() : c.getErrorStream();
            if (is != null) try (BufferedReader rd = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) { String s; while ((s = rd.readLine()) != null) if (sb.length() < 400) sb.append(s); }
            return new String[] { String.valueOf(code), sb.toString() };
        } catch (Exception e) {
            return new String[] { "0", e.getClass().getSimpleName() };
        }
    }

    /* "Stop sharing" on the notification: tell the server, then stop */
    private void stopFromNotification() {
        stat("stopped", System.currentTimeMillis());
        final String k = key;
        if (url != null && anon != null && k != null) new Thread(() -> {
            try { JSONObject o = new JSONObject(); o.put("p_key", k); post("track_stop_key", o); } catch (Exception ignored) { }
        }).start();
        finish("stopped from the notification");
    }

    private void finish(String why) {
        running = false;
        stat("stopped", System.currentTimeMillis()); stat("why", why);
        getSharedPreferences(PREFS, 0).edit().clear().apply();
        cleanup();
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
        stopSelf();
    }

    private void cleanup() {
        try { if (fused != null) fused.removeLocationUpdates(fusedCb); } catch (Throwable ignored) { }
        try { if (lm != null) lm.removeUpdates(gpsCb); } catch (Exception ignored) { }
        if (handler != null) handler.removeCallbacksAndMessages(null);
        if (thread != null) thread.quitSafely();
        if (sendLock != null && sendLock.isHeld()) sendLock.release();
    }

    /* swiped away from recent apps: the service keeps running (nothing to do) */
    @Override public void onTaskRemoved(Intent rootIntent) { super.onTaskRemoved(rootIntent); }

    @Override public void onDestroy() {
        running = false;
        cleanup();
        super.onDestroy();
    }
}
