import { ScrollViewStyleReset } from "expo-router/html";
import { type PropsWithChildren } from "react";

/**
 * This file configures the root HTML document for every web page.
 * It only runs in Node.js during static rendering / web export and is not
 * part of the native runtime, so it has no `use...` hooks.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        <meta
          name="description"
          content="CashClip is a free rewards app - earn real cash by completing surveys, watching videos, playing games, and completing offers. Cash out instantly via PayPal."
        />
        {/*
          Disable body scrolling on web. This makes ScrollView components work
          closer to how they do on native — but is entirely optional.
        */}
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
