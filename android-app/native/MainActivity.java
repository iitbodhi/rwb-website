package in.roninwb.twa;

import android.os.Bundle;

import androidx.activity.EdgeToEdge;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        EdgeToEdge.enable(this);              /* draw behind the status and navigation bars on every Android version (Play's edge-to-edge advice); the app leaves room for them */
        registerPlugin(TrackPlugin.class);   /* RWB Track: live location with the screen off */
        super.onCreate(savedInstanceState);
    }
}
