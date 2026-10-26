import { atom, read, update } from 'claude-code'
import type { Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Usage } from '../types'

const usage = atom({ plugin: 'usage-band', key: 'usage' } as const, null)

const toUsage = (context: SessionContextUsage, rateLimits: SessionRateLimit[]): Usage => ({
  contextPercent: context.percent ?? null,
  limits: rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })),
})

const colorFor = (percent: number) => (percent >= 85 ? 'error' : percent >= 60 ? 'warning' : 'success')

const fills = { success: '#4caf50', warning: '#e0a030', error: '#e5534b' }

// Stretched to the slot's width, so the viewBox is in percent and the aspect is free.
const barSvg = (percent: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="6" viewBox="0 0 100 6" preserveAspectRatio="none">` +
  `<rect width="100" height="6" rx="0.6" fill="#8884"/>` +
  `<rect width="${percent}" height="6" rx="0.6" fill="${fills[colorFor(percent)]}"/>` +
  `</svg>`

const resetLabel = (resetsAt?: string) => {
  if (!resetsAt) return null
  const d = new Date(resetsAt)
  if (Number.isNaN(d.getTime())) return null
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return `Resets ${days[d.getDay()]} ${hh}:${mm}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const { context, rateLimits } = await $.session.usage()
    await update($, usage, () => toUsage(context, rateLimits))

    return result
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, () => toUsage(e.context, e.rateLimits))

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, usage)

    if (e.props.hasSurvey || current === null) {
      return next(e)
    }

    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const Svg = 'Svg' in ui ? ui.Svg : null
    const isTerminal = e.surface === 'terminal'

    // A filled track: solid boxes on the webview surfaces, cell glyphs in the terminal.
    const Meter = ({ percent, cells }: { percent: number; cells: number }) => {
      const clamped = Math.max(0, Math.min(percent, 100))

      if (!Svg) {
        const filled = Math.round((cells * clamped) / 100)
        return (
          <Text>
            <Text color={colorFor(percent)}>{'━'.repeat(filled)}</Text>
            <Text dimColor>{'━'.repeat(cells - filled)}</Text>
          </Text>
        )
      }

      return (
        <Svg
          source={barSvg(clamped)}
          alt={`${Math.round(clamped)}% used`}
          height={6}
        />
      )
    }

    const contextPercent = current.contextPercent
    const half = Math.max(10, Math.floor((e.props.bodyColumns - 4) / 2))

    const limit = (kind: string, title: string) => {
      const found = current.limits.find(l => l.kind === kind)
      const resets = resetLabel(found?.resetsAt)

      return (
        <Box flexDirection="column" flexGrow={1} flexShrink={1} width="50%" minWidth={0} overflow="hidden" gap="xs">
          <Box flexDirection="row" justifyContent="space-between">
            <Text size="caption" weight="medium" dimColor>
              {title}
            </Text>
            <Text size="caption" weight="semibold" tabular color={found ? colorFor(found.percentUsed) : undefined}>
              {found ? `${found.percentUsed}%` : '–'}
            </Text>
          </Box>
          <Meter percent={found?.percentUsed ?? 0} cells={half} />
          {resets && (
            <Text size="footnote" dimColor>
              {resets}
            </Text>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={isTerminal ? 1 : "md"}>
        <Box flexDirection="column" gap="xs">
          <Box flexDirection="row" justifyContent="space-between">
            <Text size="caption" weight="medium" dimColor>
              Context
            </Text>
            <Text size="caption" weight="semibold" tabular color={contextPercent === null ? undefined : colorFor(contextPercent)}>
              {contextPercent === null ? '–' : `${contextPercent}%`}
            </Text>
          </Box>
          <Meter percent={contextPercent ?? 0} cells={e.props.bodyColumns} />
        </Box>
        <Box flexDirection="row" flexWrap="nowrap" width="100%" gap={isTerminal ? 4 : "lg"}>
          {limit('five_hour', 'Session (5hr)')}
          {limit('seven_day', 'Weekly (7 day)')}
        </Box>
      </Box>
    )
  })
}
