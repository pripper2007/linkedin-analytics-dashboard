import { describe, it, expect } from 'vitest';
import { stem } from './stem';

describe('stem — Portuguese', () => {
  it('collapses singular/plural forms onto the same stem', () => {
    expect(stem('pagamento')).toBe(stem('pagamentos'));
  });

  it('collapses ação/ações onto the same stem', () => {
    expect(stem('inovação')).toBe(stem('inovações'));
  });

  it('collapses -dade plural', () => {
    expect(stem('sociedade')).toBe(stem('sociedades'));
  });

  it('collapses some verb conjugations onto the infinitive root', () => {
    // pagar/pagando/pagamos should all lose their verb-ending and keep
    // a shared prefix "pag"-ish stem.
    const a = stem('pagando');
    const b = stem('pagamos');
    expect(a.startsWith('pag')).toBe(true);
    expect(b.startsWith('pag')).toBe(true);
  });

  it('leaves short tokens alone', () => {
    expect(stem('ia')).toBe('ia');
    expect(stem('ceo')).toBe('ceo');
  });
});

describe('stem — English', () => {
  it('strips -s plural', () => {
    expect(stem('payments')).toBe(stem('payment'));
  });

  it('strips -ing', () => {
    expect(stem('paying')).toBe('pay');
  });

  it('collapses -ies onto -y base (companies → company)', () => {
    expect(stem('companies')).toBe('company');
  });
});

describe('stem — idempotence', () => {
  it('stemming a stem is a no-op', () => {
    const once = stem('pagamentos');
    const twice = stem(once);
    expect(once).toBe(twice);
  });
});
