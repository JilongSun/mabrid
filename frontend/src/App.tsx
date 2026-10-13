import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'

function App() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="text-3xl font-semibold tracking-tight">Mabrid</h1>
          <CardDescription>
            MCP Apps Gateway with an optional Agent Host.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Gateway and Agent Host workflows are not connected yet.
          </p>
        </CardContent>
      </Card>
    </main>
  )
}

export default App
