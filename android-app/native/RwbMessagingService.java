package in.roninwb.twa;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Firebase messages for the RWB App. Track's silent wake-up is handled here even when the app is closed;
 * everything else goes to the app as before (Capacitor push).
 */
public class RwbMessagingService extends MessagingService {
    @Override
    public void onMessageReceived(RemoteMessage msg) {
        Map<String, String> d = msg.getData();
        if (d != null && "track_wake".equals(d.get("type"))) {   /* the server hasn't had your position for a while */
            try { TrackService.wake(getApplicationContext()); } catch (Exception e) { /* never crash on a message */ }
            return;
        }
        super.onMessageReceived(msg);
    }
}
