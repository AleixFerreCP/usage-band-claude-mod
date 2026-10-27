import { atom, read, update } from 'claude-code'
import type { Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Usage } from '../types'

const usage = atom({ plugin: 'usage-band', key: 'usage' } as const, null)
// The figures as they stood when the last prompt was sent: the bars mark what that task spent.
const baseline = atom({ plugin: 'usage-band', key: 'baseline' } as const, null)

// `percent` is whole; the tokens give it to one decimal.
const contextPercentOf = (context: SessionContextUsage) =>
  context.tokens !== undefined && context.window > 0
    ? Math.round((context.tokens / context.window) * 1000) / 10
    : context.percent

// A reading with no rate limits (a reload, before the next response reports them) keeps the last ones.
const toUsage = (previous: Usage | null, context: SessionContextUsage, rateLimits: SessionRateLimit[]): Usage => ({
  contextPercent: contextPercentOf(context) ?? previous?.contextPercent ?? null,
  limits:
    rateLimits.length > 0
      ? rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt }))
      : (previous?.limits ?? []),
})

// Kept across sessions, so a new one shows the limits before its first response reports them.
const limitsKey = 'limits'

// A window whose reset has passed is back at zero, with its next reset unknown.
const restoreLimits = (stored: unknown, now: number): Usage['limits'] =>
  Array.isArray(stored)
    ? stored.map(({ kind, percentUsed, resetsAt }) =>
        resetsAt && Date.parse(resetsAt) <= now ? { kind, percentUsed: 0 } : { kind, percentUsed, resetsAt },
      )
    : []

// One decimal, dropped when it is 0: 23.5, or 7.
const formatPercent = (percent: number) => `${Math.round(percent * 10) / 10}%`

const colorFor = (percent: number) => (percent >= 85 ? 'error' : percent >= 60 ? 'warning' : 'success')

const fills = { success: '#4caf50', warning: '#e0a030', error: '#e5534b' }
const spentFill = '#58a6ff'

// Stretched to the slot's width, so the viewBox is in percent and the aspect is free.
const barSvg = (percent: number, from: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="6" viewBox="0 0 100 6" preserveAspectRatio="none">` +
  `<rect width="100" height="6" rx="0.6" fill="#8884"/>` +
  `<rect width="${percent}" height="6" rx="0.6" fill="${fills[colorFor(percent)]}"/>` +
  (percent > from ? `<rect x="${from}" width="${percent - from}" height="6" fill="${spentFill}"/>` : '') +
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
    const stored = rateLimits.length > 0 ? [] : restoreLimits(await $.store.get(limitsKey), await $.clock.now())
    await update($, usage, previous =>
      toUsage(previous ?? { contextPercent: null, limits: stored }, context, rateLimits),
    )

    return result
  })

  on('prompt.submit', async ($, e, next) => {
    const current = await read($, usage)
    await update($, baseline, () => current)

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, previous => toUsage(previous, e.context, e.rateLimits))
    if (e.changed.includes('rateLimits') && e.rateLimits.length > 0) {
      await $.store.set(limitsKey, toUsage(null, e.context, e.rateLimits).limits)
    }

    return next(e)
  })

  // session.measure only fires once a turn ends; each response mid-turn refreshes the bars too.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)

    try {
      const { context, rateLimits } = await $.session.usage()
      await update($, usage, previous => toUsage(previous, context, rateLimits))
    } catch {
      // A failed reading keeps the last bars; the turn goes on.
    }

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, usage)
    const before = await read($, baseline)

    if (e.props.hasSurvey || current === null) {
      return next(e)
    }

    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const Svg = 'Svg' in ui ? ui.Svg : null
    const isTerminal = e.surface === 'terminal'

    // A filled track: solid boxes on the webview surfaces, cell glyphs in the terminal.
    // The part since `from` is drawn in the spent colour.
    const Meter = ({ percent, from, cells }: { percent: number; from: number; cells: number }) => {
      const clamped = Math.max(0, Math.min(percent, 100))
      const start = Math.max(0, Math.min(from, clamped))

      if (!Svg) {
        const filled = Math.round((cells * clamped) / 100)
        const kept = Math.round((cells * start) / 100)
        return (
          <Text>
            <Text color={colorFor(percent)}>{'━'.repeat(kept)}</Text>
            <Text color="suggestion">{'━'.repeat(filled - kept)}</Text>
            <Text dimColor>{'━'.repeat(cells - filled)}</Text>
          </Text>
        )
      }

      return (
        <Svg
          source={barSvg(clamped, start)}
          alt={`${formatPercent(clamped)} used, ${formatPercent(clamped - start)} by the last task`}
          height={6}
        />
      )
    }

    // A figure that dropped (a compaction, a window that reset) counts as nothing spent.
    const spentSince = (now: number, then: number | undefined) =>
      then === undefined || now < then ? 0 : Math.round((now - then) * 10) / 10

    const Figure = ({ percent, spent }: { percent: number | null; spent: number }) => (
      <Text size="caption" tabular>
        {spent > 0 && <Text color="suggestion">+{formatPercent(spent)} </Text>}
        <Text weight="semibold" color={percent === null ? undefined : colorFor(percent)}>
          {percent === null ? '–' : formatPercent(percent)}
        </Text>
      </Text>
    )

    const contextPercent = current.contextPercent
    const contextSpent =
      contextPercent === null ? 0 : spentSince(contextPercent, before?.contextPercent ?? undefined)
    const half = Math.max(10, Math.floor((e.props.bodyColumns - 4) / 2))

    const limit = (kind: string, title: string) => {
      const found = current.limits.find(l => l.kind === kind)
      const was = before?.limits.find(l => l.kind === kind)?.percentUsed
      const spent = found ? spentSince(found.percentUsed, was) : 0
      const resets = resetLabel(found?.resetsAt)

      return (
        <Box flexDirection="column" flexGrow={1} flexShrink={1} width="50%" minWidth={0} overflow="hidden" gap="xs">
          <Box flexDirection="row" justifyContent="space-between">
            <Text size="caption" weight="medium" dimColor>
              {title}
            </Text>
            <Figure percent={found?.percentUsed ?? null} spent={spent} />
          </Box>
          <Meter percent={found?.percentUsed ?? 0} from={(found?.percentUsed ?? 0) - spent} cells={half} />
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
            <Figure percent={contextPercent} spent={contextSpent} />
          </Box>
          <Meter percent={contextPercent ?? 0} from={(contextPercent ?? 0) - contextSpent} cells={e.props.bodyColumns} />
        </Box>
        <Box flexDirection="row" flexWrap="nowrap" width="100%" gap={isTerminal ? 4 : "lg"}>
          {limit('five_hour', 'Session (5hr)')}
          {limit('seven_day', 'Weekly (7 day)')}
        </Box>
      </Box>
    )
  })
}
