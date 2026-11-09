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

import com.google.android.gms.location.CurrentLocationRequest;
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
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * RWB Track: live location that keeps going with the screen off, the app minimised or swiped away (like WhatsApp).
 *
 * Staying alive
 * - A foreground service of type "location" with an ongoing notification (and a Stop button).
 * - While sharing, the phone's processor is kept awake (a partial wake lock, the screen stays off), so the 10-second
 *   heartbeat always runs: it asks for a fresh GPS fix when none came, re-starts GPS if it went quiet, and re-sends
 *   positions that couldn't go out (no signal).
 * - If the phone still freezes the app, the RWB server notices (no position for 2.5 minutes) and wakes it with a
 *   high-priority push message (RwbMessagingService → wake()), which also lets Android restart the service.
 *
 * Location
 * - Always GPS (high accuracy), like WhatsApp: a fix every 5 s while moving, every 20 s while stopped.
 * - Sent every 10 s while moving (15 m or more), at least once a minute while stopped.
 * - A position older than 2 minutes is never sent as "now" (the map would show you somewhere you no longer are).
 *
 * A report of the last 150 events (fixes, sends, errors, restarts) can be copied from the Track screen.
 */
public class TrackService extends Service {
    static final String PREFS = "rwb_track", STATS = "rwb_track_stats", LOG = "rwb_track_log";
    static final String CHANNEL = "rwb_track";
    static final String ACTION_STOP = "in.roninwb.twa.TRACK_STOP", ACTION_WAKE = "in.roninwb.twa.TRACK_WAKE";
    static final int NOTIFICATION_ID = 7301;
    static volatile boolean running = false;

    private static final long TICK = 10000L, FRESH = 120000L;
    private HandlerThread thread;
    private Handler handler;
    private PowerManager.WakeLock awake;
    private FusedLocationProviderClient fused;
    private LocationManager lm;
    private boolean moving = true, registered = false, asking = false, sending = false, failed = false;
    private Location last, sent, anchor;
    private long lastFixAt = 0, sentAt = 0, anchorAt = 0, registeredAt = 0;
    private String url, anon, key;
    private long until;

    /* ---------- from the app ---------- */
    public static void start(Context c, String url, String anon, String key, long until) {
        c.getSharedPreferences(PREFS, 0).edit().putString("url", url).putString("anon", anon).putString("key", key).putLong("until", until).apply();
        c.getSharedPreferences(STATS, 0).edit().clear().putLong("started", System.currentTimeMillis()).apply();
        c.getSharedPreferences(LOG, 0).edit().clear().apply();
        log(c, "share started, until " + time(until));
        Intent i = new Intent(c, TrackService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }

    public static void stop(Context c) {
        log(c, "stopped from the app");
        running = false;
        c.getSharedPreferences(PREFS, 0).edit().clear().apply();
        c.stopService(new Intent(c, TrackService.class));
    }

    /** The RWB server's wake-up push: get a position out now, or restart the service if Android stopped it. */
    public static void wake(Context c) {
        SharedPreferences p = c.getSharedPreferences(PREFS, 0);
        if (p.getString("key", null) == null || p.getLong("until", 0) < System.currentTimeMillis()) return;
        log(c, running ? "wake-up push: sending now" : "wake-up push: restarting");
        try {
            Intent i = new Intent(c, TrackService.class).setAction(ACTION_WAKE);
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
        } catch (Exception e) { log(c, "restart refused: " + e.getClass().getSimpleName()); }
    }

    /* ---------- the report (last 150 events) ---------- */
    private static String time(long ms) { return new SimpleDateFormat("HH:mm:ss", Locale.US).format(new Date(ms)); }
    static synchronized void log(Context c, String what) {
        SharedPreferences p = c.getSharedPreferences(LOG, 0);
        String s = p.getString("log", "") + time(System.currentTimeMillis()) + " " + what + "\n";
        int lines = 0; for (int i = s.length() - 1; i >= 0; i--) if (s.charAt(i) == '\n' && ++lines > 150) { s = s.substring(i + 1); break; }
        p.edit().putString("log", s).apply();
    }
    static String report(Context c) { return c.getSharedPreferences(LOG, 0).getString("log", ""); }
    private void log(String what) { log(this, what); }
    private void stat(String k, long v) { getSharedPreferences(STATS, 0).edit().putLong(k, v).apply(); }
    private void stat(String k, String v) { getSharedPreferences(STATS, 0).edit().putString(k, v).apply(); }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences p = getSharedPreferences(PREFS, 0);
        url = p.getString("url", null); anon = p.getString("anon", null); key = p.getString("key", null); until = p.getLong("until", 0);
        String action = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(action)) { stopFromNotification(); return START_NOT_STICKY; }
        if (!showNotification()) return START_NOT_STICKY;
        if (url == null || anon == null || key == null || until < System.currentTimeMillis()) { finish("time up"); return START_NOT_STICKY; }
        if (!running) { running = true; if (intent == null) log("restarted by Android"); begin(); }
        else if (ACTION_WAKE.equals(action) && handler != null) handler.post(() -> { askFix("wake-up"); if (last != null && fresh(last)) send(last, "wake-up"); });
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
            log("could not start: " + e.getClass().getSimpleName() + " " + e.getMessage());
            running = false;
            stopSelf();
            return false;
        }
    }

    @SuppressLint("WakelockTimeout")
    private void begin() {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        awake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "rwb:track");
        awake.setReferenceCounted(false);
        awake.acquire(Math.max(60000L, until - System.currentTimeMillis() + 120000L));   /* the whole share, never longer */
        boolean unrestricted = Build.VERSION.SDK_INT < 23 || pm.isIgnoringBatteryOptimizations(getPackageName());
        log("service running" + (unrestricted ? "" : " · battery is RESTRICTED (Android may pause it)"));
        thread = new HandlerThread("rwb-track");
        thread.start();
        handler = new Handler(thread.getLooper());
        handler.post(() -> { request(true); askFix("start"); handler.postDelayed(tick, TICK); });
    }

    /* GPS updates: every 5 s while moving, every 20 s while stopped */
    @SuppressLint("MissingPermission")
    private void request(boolean move) {
        moving = move; registered = true; registeredAt = System.currentTimeMillis();
        long interval = move ? 5000L : 20000L;
        try {
            if (fused == null) fused = LocationServices.getFusedLocationProviderClient(this);
            fused.removeLocationUpdates(fusedCb);
            LocationRequest req = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, interval)
                .setMinUpdateIntervalMillis(Math.min(interval, 3000L)).setMinUpdateDistanceMeters(0f)
                .setMaxUpdateDelayMillis(0).setWaitForAccurateLocation(false).build();
            fused.requestLocationUpdates(req, fusedCb, thread.getLooper());
            stat("provider", move ? "riding" : "stopped");
        } catch (Throwable t) {   /* no Google Play services: the phone's GPS directly */
            try {
                if (lm == null) lm = (LocationManager) getSystemService(LOCATION_SERVICE);
                lm.removeUpdates(gpsCb);
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, interval, 0f, gpsCb, thread.getLooper());
                try { lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 30000L, 0f, gpsCb, thread.getLooper()); } catch (Exception ignored) { }
                stat("provider", "gps");
            } catch (Exception e) { stat("error", "location: " + e.getMessage()); log("location error: " + e.getMessage()); }
        }
    }

    /* one fresh fix right now (when the regular updates went quiet) */
    @SuppressLint("MissingPermission")
    private void askFix(String why) {
        if (asking || fused == null) return;
        asking = true;
        try {
            CurrentLocationRequest r = new CurrentLocationRequest.Builder().setPriority(Priority.PRIORITY_HIGH_ACCURACY)
                .setMaxUpdateAgeMillis(15000L).setDurationMillis(25000L).build();
            fused.getCurrentLocation(r, null)
                .addOnSuccessListener(l -> handler.post(() -> { asking = false; if (l != null) onFix(l, why); else log("no GPS fix (" + why + ")"); }))
                .addOnFailureListener(e -> handler.post(() -> { asking = false; log("GPS failed: " + e.getMessage()); }));
        } catch (Throwable t) { asking = false; }
    }

    private final LocationCallback fusedCb = new LocationCallback() {
        @Override public void onLocationResult(LocationResult r) { Location l = r.getLastLocation(); if (l != null) onFix(l, null); }
    };
    private final LocationListener gpsCb = new LocationListener() {
        @Override public void onLocationChanged(Location l) { onFix(l, null); }
        @Override public void onProviderEnabled(String p) { log("location switched on"); }
        @Override public void onProviderDisabled(String p) { log("location switched OFF on the phone"); stat("error", "Location is switched off on the phone"); }
        @Override public void onStatusChanged(String p, int s, Bundle b) { }
    };

    private boolean fresh(Location l) { return System.currentTimeMillis() - l.getTime() < FRESH; }

    /* the service's own thread */
    private void onFix(Location l, String why) {
        if (last != null && l.getTime() <= last.getTime()) return;
        if (last != null && "network".equals(l.getProvider()) && "gps".equals(last.getProvider()) && l.getTime() - last.getTime() < 60000L) return;
        if (!fresh(l)) { log("old fix ignored (" + (System.currentTimeMillis() - l.getTime()) / 1000 + " s)"); return; }
        last = l; lastFixAt = System.currentTimeMillis();
        getSharedPreferences(STATS, 0).edit().putLong("fix", lastFixAt).putLong("acc", (long) l.getAccuracy())
            .putString("lat", String.valueOf(l.getLatitude())).putString("lng", String.valueOf(l.getLongitude())).apply();
        if (why != null) log("fix (" + why + ") ±" + Math.round(l.getAccuracy()) + " m");
        /* moving or stopped: 50 m from where you were in the last 3 minutes */
        float speed = l.hasSpeed() ? l.getSpeed() : 0f;
        if (anchor == null || anchor.distanceTo(l) > 50 || speed > 3f) { anchor = l; anchorAt = lastFixAt; }
        boolean move = lastFixAt - anchorAt < 180000L;
        if (move != moving) { log(move ? "moving again" : "stopped (3 min): fixes every 20 s"); request(move); }
        long gap = lastFixAt - sentAt;
        float moved = sent == null ? Float.MAX_VALUE : sent.distanceTo(l);
        if (sent == null || failed || (moving && moved >= 15 && gap >= 10000L) || gap >= 60000L) send(l, null);
    }

    /* every 10 s: time limit, a fix if GPS went quiet, re-start GPS if it stays quiet, re-send after no signal */
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            long now = System.currentTimeMillis();
            if (now > until) { finish("time up"); return; }
            long quiet = now - lastFixAt;
            if (quiet > (moving ? 30000L : 60000L)) askFix("GPS quiet " + quiet / 1000 + " s");
            if (quiet > 120000L && now - registeredAt > 120000L) { log("GPS quiet for 2 min: restarting GPS"); request(moving); }
            if (last != null && fresh(last) && (failed || now - sentAt >= 60000L)) send(last, failed ? "retry" : "heartbeat");
            else if (last != null && !fresh(last) && now - sentAt >= 60000L) stat("error", "Waiting for GPS (no fresh position)");
            handler.postDelayed(this, TICK);
        }
    };

    private void send(Location l, String why) {
        if (sending) return;
        sending = true;
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
                sent = l; sentAt = System.currentTimeMillis();
                if (failed) log("sent again after no signal");
                failed = false;
                stat("sent", sentAt); stat("error", "");
                if (why != null && !"heartbeat".equals(why)) log("sent (" + why + ")");
                if (r[1].contains("stopped")) finish("stopped (from another phone, or time up)");
            } else {
                if (!failed) log(code == 0 ? "no internet: " + r[1] : "server " + code + ": " + r[1]);
                failed = true;
                stat("error", code == 0 ? "No internet (retrying every 10 s)" : "server " + code + ": " + r[1]);
            }
        } catch (Exception e) {
            if (!failed) log("send error: " + e.getMessage());
            failed = true; stat("error", "No internet (retrying every 10 s)");
        } finally { sending = false; }
    }

    /* POST to a Supabase function (connections are kept open and reused by Android) */
    private String[] post(String fn, JSONObject body) {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(url + "/rest/v1/rpc/" + fn).openConnection();
            c.setRequestMethod("POST"); c.setConnectTimeout(10000); c.setReadTimeout(10000); c.setDoOutput(true);
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
        log("finished: " + why);
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
        if (awake != null && awake.isHeld()) awake.release();
    }

    /* swiped away from recent apps: the service keeps running */
    @Override public void onTaskRemoved(Intent rootIntent) { log("app swiped away (sharing continues)"); super.onTaskRemoved(rootIntent); }

    @Override public void onDestroy() {
        if (running) log("service destroyed by Android");
        running = false;
        cleanup();
        super.onDestroy();
    }
}
