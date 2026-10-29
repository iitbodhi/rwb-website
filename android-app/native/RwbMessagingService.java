package in.roninwb.twa;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Firebase messages for the RWB App. Talk voice messages are handled here (played out loud, or a "tap to play"
 * notification) even when the app is closed; everything else goes to the app as before (Capacitor push).
 */
public class RwbMessagingService extends MessagingService {
    @Override
    public void onMessageReceived(RemoteMessage msg) {
        Map<String, String> d = msg.getData();
        if (d != null && "talk".equals(d.get("type"))) {
            try { TalkService.handle(getApplicationContext(), d, msg.getSentTime()); } catch (Exception e) { /* never crash on a message */ }
            return;
        }
        super.onMessageReceived(msg);
    }
}
