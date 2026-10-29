package in.roninwb.twa;

import android.app.Activity;
import android.content.Context;
import android.location.LocationManager;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;

import com.google.android.gms.common.api.ResolvableApiException;
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
    private ActivityResultLauncher<IntentSenderRequest> locLauncher;
    private PluginCall locCall;

    @Override
    public void load() {
        try {
            locLauncher = getActivity().registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), res -> {
                PluginCall c = locCall; locCall = null;
                if (c == null) return;
                JSObject r = new JSObject(); r.put("on", res.getResultCode() == Activity.RESULT_OK || locationOn()); c.resolve(r);
            });
        } catch (Exception e) { locLauncher = null; }
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
        Double until = call.getDouble("until");
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
            if (Build.VERSION.SDK_INT >= 23 && !ignoring()) {
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

    /* ---------- Talk ---------- */
    /** Play voice messages out loud on this phone (follows the Talk switch in the app). */
    @PluginMethod
    public void talkSetReceive(PluginCall call) {
        TalkService.setReceive(getContext(), Boolean.TRUE.equals(call.getBoolean("on", true)));
        JSObject r = new JSObject(); r.put("on", TalkService.receiveOn(getContext())); call.resolve(r);
    }
    /** Ids of messages played out loud since the last call (the app marks them as heard). */
    @PluginMethod
    public void talkPlayed(PluginCall call) {
        JSObject r = new JSObject(); r.put("ids", TalkService.takePlayed(getContext())); call.resolve(r);
    }
    /** Stop a voice message playing now (e.g. the rider plays it again in the app). */
    @PluginMethod
    public void talkStop(PluginCall call) { TalkService.stop(getContext()); call.resolve(); }
}
