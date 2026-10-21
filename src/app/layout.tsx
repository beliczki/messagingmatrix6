import type { Metadata } from "next";
import type { CSSProperties } from "react";
import "./globals.css";
import "./fonts.css";
import { getActiveLookAndFeel, lookAndFeelToCssVars } from "@/lib/branding";

export const metadata: Metadata = {
  title: "MessagingMatrix",
  description: "Matrix-driven messaging workspace",
};

const THEME_INIT_SCRIPT = (serverDefault: "light" | "dark" | "system") => `
(function(){
  try {
    var def = ${JSON.stringify(serverDefault)};
    // A share link can name its theme (?theme=dark|light, share-view-params.ts).
    // Read here so it paints without a flash; it is not stored, so the
    // viewer's own preference is untouched.
    var linked = location.pathname.indexOf('/share/') === 0
      ? new URLSearchParams(location.search).get('theme') : null;
    function read(){
      if (linked === 'dark' || linked === 'light') return linked;
      return localStorage.getItem('mm6_theme') || def || 'system';
    }
    function apply(){
      var mode = read();
      var dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', dark);
    }
    apply();
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onChange = function(){ if (read() === 'system') apply(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  } catch(e) {}
})();`;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const laf = await getActiveLookAndFeel();
  const style = lookAndFeelToCssVars(laf) as CSSProperties;
  return (
    <html lang="en" style={style} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT(laf.colorMode) }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
