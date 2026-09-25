import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-experimental-design-workbench',
  ['lib/types/index.js'],
  { hostPhase: true },
)
