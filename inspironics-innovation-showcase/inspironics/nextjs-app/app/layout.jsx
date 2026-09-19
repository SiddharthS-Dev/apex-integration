import "./globals.css";

export const metadata = {
  title: "Inspironics Innovation Showcase",
  description:
    "A premium interactive knowledge platform — 235 infographic architectures. Flip any card for the full business & technical breakdown.",
  themeColor: "#050816",
  openGraph: {
    title: "Inspironics Innovation Showcase",
    description:
      "235 interactive infographic architectures — flip any card for the complete business & technical breakdown.",
    type: "website",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="bg-grid" />
        {children}
      </body>
    </html>
  );
}
