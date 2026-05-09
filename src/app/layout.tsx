import type { Metadata } from "next";
import type { CSSProperties } from "react";
import "./globals.css";
import { getActiveLookAndFeel, lookAndFeelToCssVars } from "@/lib/branding";

export const metadata: Metadata = {
  title: "MessagingMatrix",
  description: "Matrix-driven messaging workspace",
};

const THEME_INIT_SCRIPT = (serverDefault: "light" | "dark" | "system") => `
(function(){
  try {
    var def = ${JSON.stringify(serverDefault)};
    function read(){ return localStorage.getItem('mm6_theme') || def || 'system'; }
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const laf = getActiveLookAndFeel();
  const style = lookAndFeelToCssVars(laf) as CSSProperties;
  return (
    <html lang="en" style={style}>
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT(laf.colorMode) }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
