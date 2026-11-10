package in.roninwb.twa;

import android.app.Activity;
import android.content.Context;
import android.location.LocationManager;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;

import com.google.android.gms.common.api.ResolvableApiException;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.appupdate.AppUpdateOptions;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.UpdateAvailability;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.LocationSettingsRequest;
import com.google.android.gms.location.Priority;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** The web app talks to the RWB Track service through this plugin (window.Capacitor "RwbTrack"). */
@CapacitorPlugin(name = "RwbTrack")
public class TrackPlugin extends Plugin {
    /* ---------- "Turn on location?" (the standard Android pop-up, like Google Maps) ---------- */
    private ActivityResultLauncher<IntentSenderRequest> locLauncher, updLauncher;
    private PluginCall locCall;
    /* ---------- Android permission pop-ups: location, "Allow all the time", notifications ---------- */
    private ActivityResultLauncher<String[]> manyLauncher;
    private ActivityResultLauncher<String> oneLauncher;
    private PluginCall permCall;

    @Override
    public void load() {
        try {
            locLauncher = getActivity().registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), res -> {
                PluginCall c = locCall; locCall = null;
                if (c == null) return;
                JSObject r = new JSObject(); r.put("on", res.getResultCode() == Activity.RESULT_OK || locationOn()); c.resolve(r);
            });
        } catch (Exception e) { locLauncher = null; }
        /* Talk was removed (Nov 2026): tidy away its old notification channels on phones that had them */
        try { if (Build.VERSION.SDK_INT >= 26) { android.app.NotificationManager nm = (android.app.NotificationManager) getContext().getSystemService(android.content.Context.NOTIFICATION_SERVICE);
            if (nm != null) { nm.deleteNotificationChannel("talk"); nm.deleteNotificationChannel("talk_play"); } } } catch (Exception ignored) { }
        try {
            manyLauncher = getActivity().registerForActivityResult(new ActivityResultContracts.RequestMultiplePermissions(), res -> permDone());
            oneLauncher = getActivity().registerForActivityResult(new ActivityResultContracts.RequestPermission(), ok -> permDone());
        } catch (Exception e) { manyLauncher = null; oneLauncher = null; }
        try { updLauncher = getActivity().registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), res -> { }); }
        catch (Exception e) { updLauncher = null; }
    }

    /* ---------- where this app came from: "play" (Google Play Store) or "web" (roninwb.in) ---------- */
    private String channel() {
        int id = getContext().getResources().getIdentifier("rwb_channel", "string", getContext().getPackageName());
        return id == 0 ? "web" : getContext().getString(id);
    }

    /** { channel, build, version, installer } */
    @PluginMethod
    public void info(PluginCall call) {
        JSObject r = new JSObject();
        r.put("channel", channel());
        try {
            android.content.pm.PackageInfo pi = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            r.put("build", Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : (long) pi.versionCode);
            r.put("version", pi.versionName);
        } catch (Exception ignored) { }
        try {
            String inst = Build.VERSION.SDK_INT >= 30 ? getContext().getPackageManager().getInstallSourceInfo(getContext().getPackageName()).getInstallingPackageName()
                : getContext().getPackageManager().getInstallerPackageName(getContext().getPackageName());
            r.put("installer", inst == null ? "" : inst);
        } catch (Exception ignored) { }
        call.resolve(r);
    }

    /** Play Store app: is a newer version on the Play Store? With { start: true }, Google's update screen opens. */
    @PluginMethod
    public void playUpdate(PluginCall call) {
        final boolean start = Boolean.TRUE.equals(call.getBoolean("start", false));
        try {
            AppUpdateManager m = AppUpdateManagerFactory.create(getContext());
            m.getAppUpdateInfo().addOnSuccessListener(info -> {
                JSObject r = new JSObject();
                int a = info.updateAvailability();
                boolean avail = a == UpdateAvailability.UPDATE_AVAILABLE || a == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS;
                r.put("available", avail); r.put("build", info.availableVersionCode());
                if (avail && start && updLauncher != null && info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)) {
                    try { m.startUpdateFlowForResult(info, updLauncher, AppUpdateOptions.newBuilder(AppUpdateType.IMMEDIATE).build()); r.put("started", true); }
                    catch (Exception e) { r.put("error", e.getMessage()); }
                }
                call.resolve(r);
            }).addOnFailureListener(e -> { JSObject r = new JSObject(); r.put("available", false); r.put("error", e.getMessage()); call.resolve(r); });
        } catch (Throwable t) { JSObject r = new JSObject(); r.put("available", false); r.put("error", t.getMessage()); call.resolve(r); }
    }

    /** The RWB App's page on the Play Store (to update or rate). */
    @PluginMethod
    public void openStore(PluginCall call) {
        String pkg = getContext().getPackageName();
        try { getContext().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + pkg)).setPackage("com.android.vending").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
        catch (Exception e) {
            try { getContext().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + pkg)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception ignored) { }
        }
        call.resolve();
    }

    private boolean locationOn() {
        try {
            LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 28) return lm.isLocationEnabled();
            return lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        } catch (Exception e) { return true; }
    }

    /** Location (GPS) switched on? If not, Android asks "Turn on location?" right here; resolves { on }. */
    @PluginMethod
    public void ensureLocation(PluginCall call) {
        LocationRequest req = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 10000).build();
        LocationSettingsRequest settings = new LocationSettingsRequest.Builder().addLocationRequest(req).setAlwaysShow(true).build();
        try {
            LocationServices.getSettingsClient(getActivity()).checkLocationSettings(settings)
                .addOnSuccessListener(ok -> { JSObject r = new JSObject(); r.put("on", true); call.resolve(r); })
                .addOnFailureListener(e -> {
                    if (e instanceof ResolvableApiException && locLauncher != null) {
                        try {
                            if (locCall != null) { JSObject r0 = new JSObject(); r0.put("on", locationOn()); locCall.resolve(r0); }
                            locCall = call;
                            locLauncher.launch(new IntentSenderRequest.Builder(((ResolvableApiException) e).getResolution().getIntentSender()).build());
                            return;
                        } catch (Exception ignored) { locCall = null; }
                    }
                    fallback(call);
                });
        } catch (Exception e) { fallback(call); }
    }
    private void fallback(PluginCall call) {
        JSObject r = new JSObject();
        boolean on = locationOn(); r.put("on", on);
        if (!on) { try { getContext().startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); r.put("settings", true); } catch (Exception ignored) { } }
        call.resolve(r);
    }

    @PluginMethod
    public void start(PluginCall call) {
        String url = call.getString("url"), anon = call.getString("anon"), key = call.getString("key");
        /* the end time in ms: a big whole number arrives as a Long, which getDouble() ignores (it returned null, so the
           service never started); read any number type, or a number sent as text */
        Long until = null;
        Object u = call.getData().opt("until");
        if (u instanceof Number) until = ((Number) u).longValue();
        else if (u instanceof String) { try { until = (long) Double.parseDouble((String) u); } catch (Exception ignored) { } }
        if (url == null || anon == null || key == null || until == null) { call.reject("Missing sharing details"); return; }
        try {
            TrackService.start(getContext(), url, anon, key, until.longValue());
            call.resolve(state());
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "Could not start sharing");
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        TrackService.stop(getContext());
        call.resolve(state());
    }

    @PluginMethod
    public void status(PluginCall call) { call.resolve(state()); }

    /** Ask Android to let RWB run in the background without battery restrictions. */
    @PluginMethod
    public void battery(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= 23 && !ignoring() && "play".equals(channel())) {
                /* Play Store app: the app's settings page (Battery → Unrestricted), as Google Play asks */
                Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
            } else if (Build.VERSION.SDK_INT >= 23 && !ignoring()) {
                Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
            }
        } catch (Exception e) {
            try {
                Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
            } catch (Exception ignored) { }
        }
        call.resolve(state());
    }

    /** The app's settings page (Location → "Allow all the time", Battery → "Unrestricted"). */
    @PluginMethod
    public void settings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        } catch (Exception ignored) { }
        call.resolve(state());
    }

    private boolean ignoring() {
        if (Build.VERSION.SDK_INT < 23) return true;
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    private JSObject state() {
        JSObject r = new JSObject();
        r.put("running", TrackService.running);
        r.put("battery", ignoring());
        r.put("version", 3);
        try {
            android.content.SharedPreferences st = getContext().getSharedPreferences(TrackService.STATS, 0);
            for (String k : new String[] { "started", "fix", "sent", "acc", "code", "stopped" }) r.put(k, (Object) Long.valueOf(st.getLong(k, 0)));
            for (String k : new String[] { "error", "provider", "lat", "lng", "why" }) r.put(k, st.getString(k, ""));
            r.put("bgLocation", Build.VERSION.SDK_INT < 29 || getContext().checkSelfPermission("android.permission.ACCESS_BACKGROUND_LOCATION") == android.content.pm.PackageManager.PERMISSION_GRANTED);
        } catch (Exception ignored) { }
        return r;
    }


    /* ---------- permissions ---------- */
    private boolean has(String p) { return getContext().checkSelfPermission(p) == android.content.pm.PackageManager.PERMISSION_GRANTED; }
    private JSObject perms() {
        JSObject r = new JSObject();
        r.put("sdk", Build.VERSION.SDK_INT);
        r.put("fine", has("android.permission.ACCESS_FINE_LOCATION"));
        r.put("coarse", has("android.permission.ACCESS_COARSE_LOCATION"));
        r.put("background", Build.VERSION.SDK_INT < 29 || has("android.permission.ACCESS_BACKGROUND_LOCATION"));
        boolean n = Build.VERSION.SDK_INT < 33 || has("android.permission.POST_NOTIFICATIONS");
        try { n = n && androidx.core.app.NotificationManagerCompat.from(getContext()).areNotificationsEnabled(); } catch (Throwable ignored) { }
        r.put("notifications", n);
        return r;
    }
    private void permDone() { PluginCall c = permCall; permCall = null; if (c != null) c.resolve(perms()); }
    private void ask(PluginCall call, String... want) {
        if (permCall != null) { permCall.resolve(perms()); permCall = null; }
        try {
            if (want.length == 1 && oneLauncher != null) { permCall = call; oneLauncher.launch(want[0]); return; }
            if (want.length > 1 && manyLauncher != null) { permCall = call; manyLauncher.launch(want); return; }
        } catch (Exception e) { permCall = null; }
        call.resolve(perms());
    }
    /** { sdk, fine, coarse, background, notifications } */
    @PluginMethod
    public void perms(PluginCall call) { call.resolve(perms()); }
    /** Android's location pop-up (precise / approximate, while using the app). */
    @PluginMethod
    public void askLocation(PluginCall call) {
        if (has("android.permission.ACCESS_FINE_LOCATION")) { call.resolve(perms()); return; }
        ask(call, "android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION");
    }
    /** "Allow all the time": Android 10 shows it in a pop-up; Android 11+ opens RWB's location page with that option. */
    @PluginMethod
    public void askBackground(PluginCall call) {
        if (Build.VERSION.SDK_INT < 29 || has("android.permission.ACCESS_BACKGROUND_LOCATION") || !has("android.permission.ACCESS_FINE_LOCATION") && !has("android.permission.ACCESS_COARSE_LOCATION")) { call.resolve(perms()); return; }
        ask(call, "android.permission.ACCESS_BACKGROUND_LOCATION");
    }
    /** Android 13+: the "Allow RWB to send you notifications?" pop-up. */
    @PluginMethod
    public void askNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || has("android.permission.POST_NOTIFICATIONS")) { call.resolve(perms()); return; }
        ask(call, "android.permission.POST_NOTIFICATIONS");
    }

    /** The last 150 Track events (fixes, sends, errors, restarts), to copy and send for help. */
    @PluginMethod
    public void log(PluginCall call) { JSObject r = new JSObject(); r.put("log", TrackService.report(getContext())); call.resolve(r); }
}
