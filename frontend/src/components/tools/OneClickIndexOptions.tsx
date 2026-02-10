import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader2 /*,TrendingUp, TrendingDown*/ } from 'lucide-react' 

/* ---------------- CONSTANTS ---------------- */

const LOT_SIZES: Record<string, number> = {
  NIFTY: 65,
  BANKNIFTY: 30,
  FINNIFTY: 60,
  MIDCPNIFTY: 140,
  SENSEX: 20,
  BANKEX: 30,
}

const EXCHANGE_SYMBOLS: Record<string, string[]> = {
  NSE_INDEX: ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'],
  BSE_INDEX: ['SENSEX', 'BANKEX'],
}

/* ---------------- COMPONENT ---------------- */

export default function OneClickIndexOptionsTool() {
  const [hotkeysEnabled, setHotkeysEnabled] = useState(false)
  const [paperTrade, setPaperTrade] = useState(false)

  const [exchange, setExchange] = useState<'NSE_INDEX' | 'BSE_INDEX'>('NSE_INDEX')
  const [symbol, setSymbol] = useState<keyof typeof LOT_SIZES>('NIFTY')
  const [expiry, setExpiry] = useState('28FEB26')

  const [callStrike, setCallStrike] = useState('')
  const [putStrike, setPutStrike] = useState('')

  const [numLots, setNumLots] = useState(1)
  const [product, setProduct] = useState<'NRML' | 'MIS'>('NRML')

  // Calculated quantity based on numLots
  const quantity = numLots * LOT_SIZES[symbol]

  const [ltpCE, setLtpCE] = useState<number | null>(null)
  const [ltpPE, setLtpPE] = useState<number | null>(null)

  // Expiry and strikes from option chain
  const [availableExpiries, setAvailableExpiries] = useState<string[]>([])
  const [loadingExpiries, setLoadingExpiries] = useState(false)
  const [availableStrikes, setAvailableStrikes] = useState<number[]>([])
  const [loadingStrikes, setLoadingStrikes] = useState(false)
  const [spotPrice, setSpotPrice] = useState<number | null>(null)

  // Greeks and option data
  const [ceData, setCEData] = useState<any>(null)
  const [peData, setPEData] = useState<any>(null)

  // MTM tracker
  const [positions, setPositions] = useState<any[]>([])
  const [loadingPositions, setLoadingPositions] = useState(false)
  const [totalMTM, setTotalMTM] = useState(0)
  const [autoRefresh, setAutoRefresh] = useState(true)

  /* ---------------- LOT SIZE AUTO LOCK & EXPIRY FETCH ---------------- */

  useEffect(() => {
    // Update symbol if current one is not available for selected exchange
    const availableSymbols = EXCHANGE_SYMBOLS[exchange]
    if (!availableSymbols.includes(symbol as string)) {
      setSymbol(availableSymbols[0] as keyof typeof LOT_SIZES)
    }
    fetchAvailableExpiries()
  }, [symbol, exchange])

  /* ---------------- FETCH AVAILABLE EXPIRIES ---------------- */

  const fetchAvailableExpiries = async () => {
    setLoadingExpiries(true)
    try {
      const res = await fetch('/api/optionchain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: symbol,
          exchange: exchange,
        }),
      })

      const json = await res.json()
      if (json?.data && Array.isArray(json.data)) {
        // Extract unique expiry dates
        const expirySet = new Set<string>()
        json.data.forEach((row: any) => {
          if (row.expiry_date) {
            expirySet.add(row.expiry_date)
          }
        })
        const expiries = Array.from(expirySet).sort()
        setAvailableExpiries(expiries)

        // Auto-select first expiry if current is not available
        if (expiries.length > 0) {
          if (!expiries.includes(expiry)) {
            setExpiry(expiries[0])
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch available expiries:', error)
    } finally {
      setLoadingExpiries(false)
    }
  }

  /* ---------------- FETCH AVAILABLE STRIKES FROM OPTION CHAIN ---------------- */

  const fetchAvailableStrikes = async () => {
    if (!symbol || !expiry) return

    setLoadingStrikes(true)
    try {
      const res = await fetch('/api/optionchain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: symbol,
          expiry_date: expiry,
          exchange: exchange,
        }),
      })

      const json = await res.json()
      if (json?.data && Array.isArray(json.data)) {
        // Extract unique strikes from the chain
        const strikeSet = new Set<number>()
        json.data.forEach((row: any) => {
          if (row.strike_price) {
            strikeSet.add(Number(row.strike_price))
          }
        })
        const strikes = Array.from(strikeSet).sort((a, b) => a - b)
        setAvailableStrikes(strikes)
        console.log(`Found ${strikes.length} unique strikes:`, strikes.slice(0, 5), '...')

        // Get spot price from first row
        if (json.data[0]?.spot_price) {
          setSpotPrice(json.data[0].spot_price)
        }

        // Auto-select ATM strikes (always update to latest ATM)
        if (strikes.length > 0) {
          const atmIndex = Math.floor(strikes.length / 2)
          const atmStrike = String(strikes[atmIndex])
          console.log(`Setting ATM strikes: CE=${atmStrike}, PE=${atmStrike} from ${strikes.length} strikes`)
          setCallStrike(atmStrike)
          setPutStrike(atmStrike)
          console.log(`✅ Auto-selected ATM strike: ${atmStrike}`)
          // Fetch option data for selected strikes
          setTimeout(() => {
            fetchOptionData(atmStrike, 'CE')
            fetchOptionData(atmStrike, 'PE')
          }, 100)
        } else {
          console.warn('❌ No strikes found in option chain data')
        }
      } else {
        console.error('Invalid response structure:', json)
        setAvailableStrikes([])
      }
    } catch (error) {
      console.error('Failed to fetch option chain:', error)
    } finally {
      setLoadingStrikes(false)
    }
  }

  useEffect(() => {
    fetchAvailableStrikes()
  }, [symbol, expiry, exchange])

  /* ---------------- FETCH POSITIONS FOR MTM TRACKER ---------------- */

  const fetchPositions = async () => {
    setLoadingPositions(true)
    try {
      const res = await fetch('/api/positionbook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      // Check if response is actually JSON
      const contentType = res.headers.get('content-type')
      if (!contentType?.includes('application/json')) {
        console.warn('⚠️ Positions endpoint returned non-JSON (likely not authenticated or endpoint error)')
        setPositions([])
        setTotalMTM(0)
        return
      }

      if (!res.ok) {
        console.warn(`⚠️ Positions fetch returned ${res.status} - user may not be authenticated`)
        setPositions([])
        setTotalMTM(0)
        return
      }

      const json = await res.json()
      if (json?.data && Array.isArray(json.data)) {
        setPositions(json.data)
        console.log(`📊 Fetched ${json.data.length} positions`)

        // Calculate total MTM
        const total = json.data.reduce((sum: number, pos: any) => {
          const mtm = Number(pos.mtm) || 0
          return sum + mtm
        }, 0)
        setTotalMTM(total)
      } else {
        setPositions([])
        setTotalMTM(0)
      }
    } catch (error) {
      console.warn('⚠️ Failed to fetch positions (this is OK if user is not logged in):', error)
      setPositions([])
      setTotalMTM(0)
    } finally {
      setLoadingPositions(false)
    }
  }

  // Auto-refresh positions every 2 seconds if enabled
  useEffect(() => {
    if (!autoRefresh) return

    fetchPositions() // Fetch immediately
    const interval = setInterval(fetchPositions, 2000)

    return () => clearInterval(interval)
  }, [autoRefresh])

  /* ---------------- LTP & GREEKS FETCH ---------------- */

  const fetchOptionData = async (strike: string, type: 'CE' | 'PE') => {
    if (!strike) return

    try {
      const res = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: `${symbol}${expiry}${strike}${type}`,
          exchange: 'NFO',
        }),
      })

      const json = await res.json()
      const data = json?.data

      if (data) {
        if (type === 'CE') {
          setLtpCE(data.ltp)
          setCEData(data)
        } else {
          setLtpPE(data.ltp)
          setPEData(data)
        }
      }
    } catch (error) {
      console.error('Failed to fetch option data:', error)
    }
  }

  /* ---------------- ORDER ---------------- */

  const placeOrder = async (action: 'BUY' | 'SELL', optionType: 'CE' | 'PE') => {
    if (!hotkeysEnabled) return

    const strike = optionType === 'CE' ? callStrike : putStrike
    if (!strike) return

    if (paperTrade) {
      console.log('🧪 PAPER TRADE', { action, optionType, strike })
      return
    }

    await fetch('/api/optionsorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        strategy: 'OneClickTool',
        underlying: symbol,
        exchange,
        expiry_date: expiry,
        strike_price: Number(strike),
        option_type: optionType,
        action,
        quantity,
        pricetype: 'MARKET',
        product,
        splitsize: 0,
      }),
    })
  }

  /* ---------------- PANIC ---------------- */

  const panicSquareOff = async () => {
    if (paperTrade) return

    await fetch('/api/closeposition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy: 'OneClickTool' }),
    })
  }

  /* ---------------- HOTKEYS ---------------- */

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      console.log('🎹 Key pressed:', e.key, 'Hotkeys enabled:', hotkeysEnabled)
      
      if (!hotkeysEnabled) {
        console.log('⚠️ Hotkeys disabled - ignoring key press')
        return
      }

      if (!callStrike || !putStrike) {
        console.log('⚠️ Strikes not selected - ignoring key press')
        return
      }

      console.log('✅ Processing order for key:', e.key)

      if (e.key === 'ArrowUp') {
        console.log('📈 BUY CALL - Strike:', callStrike)
        placeOrder('BUY', 'CE')
      }
      if (e.key === 'ArrowDown') {
        console.log('📉 BUY PUT - Strike:', putStrike)
        placeOrder('BUY', 'PE')
      }
      if (e.key === 'ArrowLeft') {
        console.log('📈 SELL CALL - Strike:', callStrike)
        placeOrder('SELL', 'CE')
      }
      if (e.key === 'ArrowRight') {
        console.log('📉 SELL PUT - Strike:', putStrike)
        placeOrder('SELL', 'PE')
      }

      // Reverse
      if (e.key.toLowerCase() === 'r') {
        console.log('🔄 REVERSE - Selling both CE and PE')
        placeOrder('SELL', 'CE')
        placeOrder('SELL', 'PE')
      }

      // Panic
      if (e.key === 'Escape') {
        console.log('🔴 PANIC CLOSE - Closing all positions')
        panicSquareOff()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [hotkeysEnabled, callStrike, putStrike, paperTrade])

  /* ---------------- UI ---------------- */

  return (
    <Card className="w-full">
      <CardHeader className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950 dark:to-orange-950 border-b">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl">
              ⚡ One-Click Index Options
            </CardTitle>
            <CardDescription className="mt-2">
              Lightning-fast keyboard-driven options trading
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {paperTrade && <Badge variant="secondary" className="h-fit">📄 Paper</Badge>}
            {hotkeysEnabled && <Badge className="h-fit bg-green-600">🎯 Active</Badge>}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {/* Control Panel - Top Row */}
        <div className="bg-slate-100 dark:bg-slate-800 p-4 grid grid-cols-7 gap-3 border-b">
          <div>
            <Label className="text-xs">Exchange</Label>
            <Select value={exchange} onValueChange={(v) => setExchange(v as any)}>
              <SelectTrigger className="mt-1 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NSE_INDEX">NSE</SelectItem>
                <SelectItem value="BSE_INDEX">BSE</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Symbol</Label>
            <Select value={symbol} onValueChange={(v) => setSymbol(v as any)}>
              <SelectTrigger className="mt-1 h-8 text-xs font-bold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXCHANGE_SYMBOLS[exchange].map((sym) => (
                  <SelectItem key={sym} value={sym}>
                    {sym}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Expiry</Label>
            <Select value={expiry} onValueChange={(v) => setExpiry(v)}>
              <SelectTrigger className="mt-1 h-8 text-xs font-bold">
                {loadingExpiries ? <span>...</span> : <SelectValue placeholder="Select" />}
              </SelectTrigger>
              <SelectContent>
                {availableExpiries.map((exp) => (
                  <SelectItem key={exp} value={exp}>
                    {exp}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">CE Strike</Label>
            <Select value={callStrike} onValueChange={(v) => {
              setCallStrike(v)
              fetchOptionData(v, 'CE')
            }} disabled={availableStrikes.length === 0}>
              <SelectTrigger className="mt-1 h-8 text-xs font-bold">
                {loadingStrikes ? <span>Loading strikes...</span> : <SelectValue placeholder="Select CE strike" />}
              </SelectTrigger>
              <SelectContent className="max-h-48">
                {availableStrikes.length === 0 ? (
                  <div className="px-2 py-1 text-xs text-muted-foreground">No strikes available</div>
                ) : (
                  availableStrikes.map((strike) => (
                    <SelectItem key={`ce-${strike}`} value={String(strike)}>
                      {strike}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">PE Strike</Label>
            <Select value={putStrike} onValueChange={(v) => {
              setPutStrike(v)
              fetchOptionData(v, 'PE')
            }} disabled={availableStrikes.length === 0}>
              <SelectTrigger className="mt-1 h-8 text-xs font-bold">
                {loadingStrikes ? <span>Loading strikes...</span> : <SelectValue placeholder="Select PE strike" />}
              </SelectTrigger>
              <SelectContent className="max-h-48">
                {availableStrikes.length === 0 ? (
                  <div className="px-2 py-1 text-xs text-muted-foreground">No strikes available</div>
                ) : (
                  availableStrikes.map((strike) => (
                    <SelectItem key={`pe-${strike}`} value={String(strike)}>
                      {strike}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Lots</Label>
            <Select value={String(numLots)} onValueChange={(v) => setNumLots(Number(v))}>
              <SelectTrigger className="mt-1 h-8 text-xs font-bold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 10, 15, 20].map((lot) => (
                  <SelectItem key={lot} value={String(lot)}>
                    {lot} lot{lot > 1 ? 's' : ''} ({lot * LOT_SIZES[symbol]} qty)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Mode</Label>
            <Select value={product} onValueChange={(v) => setProduct(v as any)}>
              <SelectTrigger className="mt-1 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NRML">NRML</SelectItem>
                <SelectItem value="MIS">MIS</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Main Trading Interface - Two Panels */}
        <div className="grid grid-cols-2 gap-0 border-b">
          {/* CALL PANEL */}
          <div className="border-r bg-emerald-50 dark:bg-emerald-950/20 p-6">
            <div className="text-center mb-6">
              <h3 className="text-xl font-bold text-emerald-700 dark:text-emerald-400 mb-2">
                {symbol} {callStrike} CE
              </h3>
              <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-300 mb-1">
                ₹{ltpCE?.toFixed(2) ?? '--'}
              </div>
              {ceData && (
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>IV: {ceData.iv?.toFixed(2) ?? '--'} | OI: {ceData.open_interest?.toLocaleString() ?? '--'}</p>
                  <p>Delta: {ceData.delta?.toFixed(3) ?? '--'} | Theta: {ceData.theta?.toFixed(3) ?? '--'}</p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Button 
                className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-lg"
                onClick={() => placeOrder('BUY', 'CE')}
              >
                ↑ BUY CALL
              </Button>
              <Button 
                className="w-full h-12 bg-emerald-200 dark:bg-emerald-800 text-emerald-900 dark:text-emerald-100 hover:bg-emerald-300 dark:hover:bg-emerald-700 font-bold text-lg"
                onClick={() => placeOrder('SELL', 'CE')}
              >
                ← SELL CALL
              </Button>
            </div>
          </div>

          {/* PUT PANEL */}
          <div className="bg-red-50 dark:bg-red-950/20 p-6">
            <div className="text-center mb-6">
              <h3 className="text-xl font-bold text-red-700 dark:text-red-400 mb-2">
                {symbol} {putStrike} PE
              </h3>
              <div className="text-3xl font-bold text-red-600 dark:text-red-300 mb-1">
                ₹{ltpPE?.toFixed(2) ?? '--'}
              </div>
              {peData && (
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>IV: {peData.iv?.toFixed(2) ?? '--'} | OI: {peData.open_interest?.toLocaleString() ?? '--'}</p>
                  <p>Delta: {peData.delta?.toFixed(3) ?? '--'} | Theta: {peData.theta?.toFixed(3) ?? '--'}</p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Button 
                className="w-full h-12 bg-red-600 hover:bg-red-700 text-white font-bold text-lg"
                onClick={() => placeOrder('BUY', 'PE')}
              >
                ↓ BUY PUT
              </Button>
              <Button 
                className="w-full h-12 bg-red-200 dark:bg-red-800 text-red-900 dark:text-red-100 hover:bg-red-300 dark:hover:bg-red-700 font-bold text-lg"
                onClick={() => placeOrder('SELL', 'PE')}
              >
                → SELL PUT
              </Button>
            </div>
          </div>
        </div>

        {/* Bottom Controls */}
        <div className="bg-slate-50 dark:bg-slate-900 p-4 grid grid-cols-5 gap-4 border-t">
          <div>
            <Label className="text-xs">Hotkeys</Label>
            <div className="mt-1 flex items-center gap-2">
              <Switch checked={hotkeysEnabled} onCheckedChange={setHotkeysEnabled} />
              <span className="text-xs">{hotkeysEnabled ? '✓ Enabled' : '✗ Disabled'}</span>
            </div>
          </div>

          <div>
            <Label className="text-xs">Paper Trade</Label>
            <div className="mt-1 flex items-center gap-2">
              <Switch checked={paperTrade} onCheckedChange={setPaperTrade} />
              <span className="text-xs">{paperTrade ? '📄 Yes' : '💰 No'}</span>
            </div>
          </div>

          {spotPrice && (
            <div>
              <Label className="text-xs">Spot Price</Label>
              <div className="mt-1 text-lg font-bold text-blue-600 dark:text-blue-400">
                ₹{spotPrice.toFixed(2)}
              </div>
            </div>
          )}

          <div>
            <Label className="text-xs">Keyboard Help</Label>
            <p className="mt-1 text-xs">↑↓←→ to trade | R to reverse | ESC panic</p>
          </div>

          <div>
            <Button
              variant="destructive"
              className="w-full mt-5"
              onClick={panicSquareOff}
            >
              🔴 PANIC CLOSE
            </Button>
          </div>
        </div>

        {/* MTM TRACKER SECTION */}
        <div className="mt-6 border-t pt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold flex items-center gap-2">
              📊 Live MTM Tracker
            </h3>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Switch 
                  checked={autoRefresh} 
                  onCheckedChange={setAutoRefresh}
                  id="auto-refresh"
                />
                <Label htmlFor="auto-refresh" className="text-xs">Auto Refresh</Label>
              </div>
              {loadingPositions && <Loader2 className="h-4 w-4 animate-spin" />}
            </div>
          </div>

          {/* MTM Summary */}
          {positions.length > 0 && (
            <div className="grid grid-cols-3 gap-4 mb-4 p-3 bg-slate-100 dark:bg-slate-800 rounded-lg border">
              <div>
                <p className="text-xs text-muted-foreground">Total MTM</p>
                <p className={`text-2xl font-bold ${
                  totalMTM >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                }`}>
                  ₹{totalMTM.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Positions</p>
                <p className="text-2xl font-bold">{positions.length}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Last Update</p>
                <p className="text-xs font-mono">{new Date().toLocaleTimeString()}</p>
              </div>
            </div>
          )}

          {/* Positions Table */}
          {positions.length > 0 ? (
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-slate-100 dark:bg-slate-800 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Symbol</th>
                    <th className="px-3 py-2 text-center font-semibold">Type</th>
                    <th className="px-3 py-2 text-right font-semibold">Qty</th>
                    <th className="px-3 py-2 text-right font-semibold">Entry</th>
                    <th className="px-3 py-2 text-right font-semibold">LTP</th>
                    <th className="px-3 py-2 text-right font-semibold">MTM</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((pos: any, idx: number) => {
                    const mtm = Number(pos.mtm) || 0
                    const isBuy = pos.buy_quantity > 0 && (pos.buy_quantity > pos.sell_quantity)
                    return (
                      <tr key={idx} className="border-b hover:bg-slate-50 dark:hover:bg-slate-900">
                        <td className="px-3 py-2 font-mono">{pos.symbol}</td>
                        <td className="px-3 py-2 text-center">
                          <Badge variant={isBuy ? 'default' : 'destructive'} className="text-xs">
                            {isBuy ? 'LONG' : 'SHORT'}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right font-bold">
                          {Math.abs(Number(pos.net_quantity) || 0)}
                        </td>
                        <td className="px-3 py-2 text-right">₹{Number(pos.average_price || 0).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">₹{Number(pos.ltp || 0).toFixed(2)}</td>
                        <td className={`px-3 py-2 text-right font-bold ${
                          mtm >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                        }`}>
                          ₹{mtm >= 0 ? '+' : ''}{mtm.toFixed(2)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <p>No open positions</p>
              <p className="text-xs mt-2">Your orders will appear here</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
