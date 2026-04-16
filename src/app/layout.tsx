import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Brain",
  description: "Campaign performance reports and optimization intelligence for AlzaAds clients",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="cs" className="h-full antialiased">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("aabrain_theme");if(t==='"dark"')document.documentElement.dataset.theme="dark";}catch(e){}})();`,
          }}
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
