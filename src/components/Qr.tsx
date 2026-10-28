import { useMemo } from 'react'
import QRCode from 'qrcode'

/**
 * QR of the plain receiver address only. Arc has no payment-URI standard that wallets agree on, so this
 * does not claim to be one: scanning it yields text to paste into a wallet's address field.
 */
export function AddressQr({ value, label, size = 176 }: { value: string; label: string; size?: number }) {
  const cells = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' })
    return { size: qr.modules.size, data: qr.modules.data }
  }, [value])
  const quiet = 3
  const dim = cells.size + quiet * 2
  const path: string[] = []
  for (let y = 0; y < cells.size; y += 1) {
    for (let x = 0; x < cells.size; x += 1) {
      if (cells.data[y * cells.size + x]) path.push(`M${x + quiet} ${y + quiet}h1v1h-1z`)
    }
  }
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${dim} ${dim}`} width={size} height={size} shapeRendering="crispEdges" className="rounded-2xl bg-white">
      <path d={path.join('')} fill="#122d45" />
    </svg>
  )
}
