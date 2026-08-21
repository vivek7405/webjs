export interface TemplateResult {
  _$webjs: 'template';
  strings: TemplateStringsArray | string[];
  values: unknown[];
}

export function html(strings: TemplateStringsArray | string[], ...values: unknown[]): TemplateResult;
export function isTemplate(x: unknown): x is TemplateResult;
export const MARKER: 'wjm-';
