import { createFileRoute } from '@tanstack/solid-router'
import { For } from 'solid-js'
import {
  Zap,
  Server,
  Route as RouteIcon,
  Shield,
  Waves,
  Sparkles,
} from 'lucide-solid'

export const Route = createFileRoute('/')({ component: App })

function App() {
  return null
}
