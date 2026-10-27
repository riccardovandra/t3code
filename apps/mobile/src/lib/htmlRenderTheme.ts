import { HTML_RENDER_DEFAULT_FONTS, htmlRenderTheme } from "@t3tools/shared/htmlRender";
import type { ThemeColors } from "@t3tools/shared/themePalettes";

import {
  DEFAULT_MOBILE_THEME_ID,
  getMobileThemeColors,
  nativeColors,
  type MobileThemeAppearance,
  type MobileThemeId,
  type MobileThemeVariables,
} from "./mobileTheme";

interface MobileWebViewThemeInput {
  readonly themeId: MobileThemeId;
  readonly appearance: MobileThemeAppearance;
  readonly variables: MobileThemeVariables;
  readonly systemColors: boolean;
  readonly platform: string;
}

/** The palette on screen, in web colours, for pages shown in a WebView. */
export function mobileWebViewThemeColors(input: MobileWebViewThemeInput): ThemeColors {
  const { variables: v } = input;
  const palette = getMobileThemeColors(
    input.themeId === "material-you" ? DEFAULT_MOBILE_THEME_ID : input.themeId,
    input.appearance,
  );
  const colors = nativeColors(
    input.systemColors
      ? {
          ...palette,
          text: v["--color-foreground"],
          textMuted: v["--color-foreground-secondary"],
          muted: v["--color-subtle"],
          mutedForeground: v["--color-foreground-muted"],
          surface: v["--color-card"],
          surfaceRaised: v["--color-card-alt"],
          surfaceOverlay: v["--color-card-alt"],
          border: v["--color-border"],
          input: v["--color-input-border"],
          focus: v["--color-focus"],
          accent: v["--color-primary"],
          accentForeground: v["--color-primary-foreground"],
          accentSurface: v["--color-inline-skill-background"],
          accentSurfaceForeground: v["--color-inline-skill-foreground"],
          messageAction: v["--color-primary"],
          messageActionForeground: v["--color-primary-foreground"],
          secondary: v["--color-secondary"],
          secondaryForeground: v["--color-secondary-foreground"],
          errorSurface: v["--color-danger"],
          errorForeground: v["--color-danger-foreground"],
          codeBackground: v["--color-md-code-bg"],
          codeForeground: v["--color-md-code-text"],
        }
      : palette,
  );
  const canvas = v[input.platform === "android" ? "--color-thread-canvas" : "--color-screen"];
  return { ...colors, canvas };
}

/** WebViews cannot load bundled app fonts; use system stacks. */
export function mobileHtmlRenderTheme(input: MobileWebViewThemeInput) {
  return htmlRenderTheme(
    mobileWebViewThemeColors(input),
    input.appearance,
    HTML_RENDER_DEFAULT_FONTS,
  );
}
