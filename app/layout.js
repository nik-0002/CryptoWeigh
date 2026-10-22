import './globals.css';

export const metadata = {
  title: 'Proof of Fair Weight',
  description: 'Secure scale ledger',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
