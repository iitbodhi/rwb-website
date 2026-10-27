package in.roninwb.twa;

import android.content.Context;
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
}
