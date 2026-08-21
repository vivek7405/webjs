export interface CSSResult {
  _$webjsCss: true;
  text: string;
}

export function css(strings: TemplateStringsArray | string[], ...values: unknown[]): CSSResult;
export function isCSS(x: unknown): x is CSSResult;
export function adoptStyles(root: ShadowRoot | Document, styles: CSSResult[]): void;
export function stylesToString(styles: CSSResult[]): string;
