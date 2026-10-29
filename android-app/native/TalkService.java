package in.roninwb.twa;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.ToneGenerator;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import java.util.ArrayDeque;
import java.util.Map;

/**
 * RWB Talk: plays a voice message out loud the moment it arrives, even with the screen off or the app closed
 * (like the SOS siren). Started by RwbMessagingService for each Talk message that should be heard straight away
 * (the receiver shares their live location, or is FAM). Messages arriving together play one after another.
 * Anything that can't be played now (a phone call, too old, no internet) becomes a "tap to play" notification.
 */
public class TalkService extends Service {
    static final String CH_NEW = "talk", CH_PLAY = "talk_play";
    static final String ACTION_PLAY = "in.roninwb.talk.PLAY", ACTION_STOP = "in.roninwb.talk.STOP";
    static final int PLAY_ID = 7301;
    static final long FRESH_MS = 10 * 60 * 1000L;          // older than 10 minutes: not played out loud any more
    static final String PREFS = "rwb_talk";

    private final ArrayDeque<Bundle> queue = new ArrayDeque<>();
    private final Handler main = new Handler(Looper.getMainLooper());
    private MediaPlayer mp;
    private Bundle current;
    private AudioManager am;
    private AudioFocusRequest focusReq;
    private Runnable guard;

    /* ---------- from the Firebase message ---------- */
    static void handle(Context c, Map<String, String> d, long sentAt) {
        channels(c);
        Bundle b = new Bundle();
        for (String k : new String[]{"id", "audio", "from", "to", "secs", "title", "body", "aloud"}) b.putString(k, d.get(k) == null ? "" : d.get(k));
        long age = sentAt > 0 ? System.currentTimeMillis() - sentAt : 0;
        boolean aloud = "1".equals(b.getString("aloud")) && age < FRESH_MS && !b.getString("audio", "").isEmpty() && receiveOn(c);
        if (aloud) {
            Intent i = new Intent(c, TalkService.class).setAction(ACTION_PLAY).putExtras(b);
            try {
                if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
                return;
            } catch (Exception e) { /* Android didn't allow it now: a notification instead */ }
        }
        notifyMessage(c, b, false);
    }

    /* the app can switch playing out loud off on this phone (Talk off in the app) */
    static boolean receiveOn(Context c) { return c.getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean("on", true); }
    static void setReceive(Context c, boolean on) { c.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("on", on).apply(); }
    /* messages played out loud, so the app marks them as heard */
    static synchronized void markPlayed(Context c, String id) {
        SharedPreferences p = c.getSharedPreferences(PREFS, MODE_PRIVATE);
        String s = p.getString("played", "");
        if (s.length() > 2000) s = s.substring(s.length() - 1000);
        p.edit().putString("played", s.isEmpty() ? id : s + "," + id).apply();
    }
    static synchronized String takePlayed(Context c) {
        SharedPreferences p = c.getSharedPreferences(PREFS, MODE_PRIVATE);
        String s = p.getString("played", "");
        p.edit().putString("played", "").apply();
        return s;
    }
    static void stop(Context c) {
        try { c.startService(new Intent(c, TalkService.class).setAction(ACTION_STOP)); } catch (Exception e) { /* not running */ }
    }

    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(NOTIFICATION_SERVICE);
        if (nm.getNotificationChannel(CH_NEW) == null) {
            NotificationChannel ch = new NotificationChannel(CH_NEW, "Talk voice messages", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Voice messages from riders on Track");
            ch.enableVibration(true);
            nm.createNotificationChannel(ch);
        }
        if (nm.getNotificationChannel(CH_PLAY) == null) {
            NotificationChannel ch = new NotificationChannel(CH_PLAY, "Talk playing", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown while a voice message plays");
            ch.setShowBadge(false);
            ch.setSound(null, null);
            nm.createNotificationChannel(ch);
        }
    }
    static PendingIntent openTalk(Context c, int req) {
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("https://roninwb.in/app/#track/talk")).setPackage(c.getPackageName())
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (open.resolveActivity(c.getPackageManager()) == null) open = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        return PendingIntent.getActivity(c, req, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }
    static int icon(Context c) {
        int i = c.getResources().getIdentifier("ic_stat_rwb", "drawable", c.getPackageName());
        return i != 0 ? i : c.getApplicationInfo().icon;
    }
    /* "🎙️ Rider · Voice message (0:23)" — tap to play it in Track → Talk */
    static void notifyMessage(Context c, Bundle b, boolean played) {
        channels(c);
        NotificationManager nm = (NotificationManager) c.getSystemService(NOTIFICATION_SERVICE);
        int id = 7400 + (int) (Math.abs(b.getString("id", "0").hashCode()) % 500);
        String title = b.getString("title", "🎙️ Voice message"), body = b.getString("body", "");
        Notification.Builder n = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CH_NEW) : new Notification.Builder(c);
        n.setSmallIcon(icon(c)).setContentTitle(title).setContentText(played ? body + " · played · tap to replay" : body + " · tap to play")
            .setAutoCancel(true).setContentIntent(openTalk(c, id)).setCategory(Notification.CATEGORY_MESSAGE);
        if (played) n.setOnlyAlertOnce(true);
        if (Build.VERSION.SDK_INT >= 26 && played) n.setTimeoutAfter(6 * 60 * 60 * 1000L);
        try { nm.notify(id, n.build()); } catch (Exception e) { /* notifications switched off */ }
    }

    /* ---------- the service ---------- */
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(action)) { queue.clear(); finishCurrent(false, true); stopAll(); return START_NOT_STICKY; }
        if (ACTION_PLAY.equals(action) && intent.getExtras() != null) {
            Bundle b = intent.getExtras();
            if (!foreground(b)) { notifyMessage(this, b, false); if (current == null && queue.isEmpty()) stopAll(); return START_NOT_STICKY; }
            queue.add(b);
            if (current == null) playNext();
        } else if (current == null && queue.isEmpty()) stopAll();
        return START_NOT_STICKY;
    }

    private boolean foreground(Bundle b) {
        channels(this);
        PendingIntent stopPi = PendingIntent.getService(this, 2, new Intent(this, TalkService.class).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder n = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH_PLAY) : new Notification.Builder(this);
        n.setSmallIcon(icon(this)).setContentTitle(b.getString("title", "🎙️ Voice message")).setContentText("Playing · " + b.getString("body", ""))
            .setOngoing(true).setContentIntent(openTalk(this, 3)).addAction(new Notification.Action.Builder(0, "Stop", stopPi).build());
        if (Build.VERSION.SDK_INT >= 31) n.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(PLAY_ID, n.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            else startForeground(PLAY_ID, n.build());
            return true;
        } catch (Exception e) { return false; }
    }

    private void playNext() {
        current = queue.poll();
        if (current == null) { stopAll(); return; }
        final Bundle b = current;
        foreground(b);
        am = (AudioManager) getSystemService(AUDIO_SERVICE);
        AudioAttributes attrs = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
        /* not during a phone call; music and navigation get quieter while it plays */
        boolean inCall = am.getMode() == AudioManager.MODE_IN_CALL || am.getMode() == AudioManager.MODE_IN_COMMUNICATION;
        int granted;
        if (Build.VERSION.SDK_INT >= 26) {
            focusReq = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(attrs).build();
            granted = am.requestAudioFocus(focusReq);
        } else granted = am.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
        if (inCall || granted != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { notifyMessage(this, b, false); finishCurrent(false, false); return; }
        try { ToneGenerator t = new ToneGenerator(AudioManager.STREAM_MUSIC, 70); t.startTone(ToneGenerator.TONE_PROP_ACK, 180); main.postDelayed(t::release, 600); }
        catch (Exception e) { /* no beep */ }
        main.postDelayed(() -> start(b, attrs), 450);
    }

    private void start(Bundle b, AudioAttributes attrs) {
        if (current != b) return;
        try {
            mp = new MediaPlayer();
            mp.setAudioAttributes(attrs);
            mp.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK);
            mp.setDataSource(this, Uri.parse(b.getString("audio")));
            mp.setOnPreparedListener(p -> p.start());
            mp.setOnCompletionListener(p -> finishCurrent(true, false));
            mp.setOnErrorListener((p, what, extra) -> { finishCurrent(false, false); return true; });
            mp.prepareAsync();
            int secs = 180; try { secs = Integer.parseInt(b.getString("secs", "180")); } catch (Exception e) { /* default */ }
            final MediaPlayer mine = mp;
            guard = () -> { if (mp == mine) finishCurrent(true, false); };     // never stuck: download time + length + margin
            main.postDelayed(guard, (secs + 60) * 1000L);
        } catch (Exception e) { finishCurrent(false, false); }
    }

    /* one message done (played, or not): a notification to replay it, then the next one */
    private void finishCurrent(boolean played, boolean stopping) {
        if (guard != null) { main.removeCallbacks(guard); guard = null; }
        if (mp != null) { try { mp.stop(); } catch (Exception e) { /* not started */ } try { mp.release(); } catch (Exception e) { /* gone */ } mp = null; }
        if (am != null) { if (Build.VERSION.SDK_INT >= 26 && focusReq != null) am.abandonAudioFocusRequest(focusReq); else am.abandonAudioFocus(null); }
        Bundle b = current; current = null;
        if (b != null) {
            if (played) markPlayed(this, b.getString("id", ""));
            notifyMessage(this, b, played);
        }
        if (!stopping) playNext();
    }

    private void stopAll() {
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        queue.clear();
        if (mp != null) { try { mp.release(); } catch (Exception e) { /* gone */ } mp = null; }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
