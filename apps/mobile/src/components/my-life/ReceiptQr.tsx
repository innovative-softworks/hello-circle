import { View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

// Encodes the reference itself, same as web's MyBookings.tsx BookingQr —
// not a special check-in token. Vendor-side check-in is manual ref entry
// (confirmed no QR-scanning integration exists anywhere), so this is
// display-only.
export function ReceiptQr({ reference }: { reference: string }) {
  return (
    <View style={{ alignItems: 'center', padding: 16, backgroundColor: '#fff', borderRadius: 12, alignSelf: 'center' }}>
      <QRCode value={reference} size={200} />
    </View>
  );
}
