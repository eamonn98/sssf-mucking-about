import {
  Boxes,
  Building2,
  Cloud,
  Database,
  MonitorSmartphone,
  Radio,
  Server,
  Zap,
  type LucideIcon,
} from 'lucide-react'

import type { ComponentType } from '@/lib/types'

export const TYPE_ICONS: Record<ComponentType, LucideIcon> = {
  frontend: MonitorSmartphone,
  backend_service: Server,
  microservice: Boxes,
  database: Database,
  cache: Zap,
  message_broker: Radio,
  external_api: Cloud,
  third_party_service: Building2,
}
