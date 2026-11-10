package in.roninwb.twa;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TrackPlugin.class);   /* RWB Track: live location with the screen off */
        super.onCreate(savedInstanceState);
    }
}
