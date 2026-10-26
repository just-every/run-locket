/** Compare the retained vendor snapshot without asserting contract allocation. */
export function accountingValueComparison(totalCents: number, contractValueCents: number | null) {
 if (contractValueCents === null || contractValueCents <= 0) return null
 // Integer division rounds half up to two percentage places without losing cents.
 const basisPoints = (BigInt(totalCents) * 10000n + BigInt(contractValueCents) / 2n) / BigInt(contractValueCents)
 return { contractValueCents, percent: `${basisPoints / 100n}.${String(basisPoints % 100n).padStart(2, '0')}`, allocation: 'unconfirmed' as const }
}
