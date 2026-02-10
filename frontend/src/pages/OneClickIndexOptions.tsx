import OneClickIndexOptionsTool from '@/components/tools/OneClickIndexOptions'

export default function OneClickIndexOptionsPage() {
  return (
    <div className="py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">One-Click Index Options</h1>
        <p className="text-muted-foreground mt-1">
          Keyboard-driven one-click index options trading
        </p>
      </div>

      <OneClickIndexOptionsTool />
    </div>
  )
}
