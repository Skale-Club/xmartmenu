export function usageLineDescription(args: { events: number; costUsd: number; chargeUsd: number; amountMinor: number; currency: string; until: Date }): string {
  const day = args.until.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  const money = (args.amountMinor / 100).toLocaleString('pt-BR', { style: 'currency', currency: args.currency.toUpperCase() })
  return `Inteligência artificial — ${args.events} chamadas até ${day} (custo US$ ${args.costUsd.toFixed(4)}, com margem US$ ${args.chargeUsd.toFixed(4)}): ${money}`
}
