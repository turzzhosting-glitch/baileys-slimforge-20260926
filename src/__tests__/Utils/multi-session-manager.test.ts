import { jest } from '@jest/globals'
import { makeMultiSessionManager } from '../../Utils/multi-session-manager'

describe('MultiSessionManager', () => {
	it('deduplicates concurrent starts for the same id', async () => {
		let resolveCreation: ((value: string) => void) | undefined
		const create = jest.fn(
			() =>
				new Promise<string>(resolve => {
					resolveCreation = resolve
				})
		)
		const manager = makeMultiSessionManager({ create })

		const first = manager.start('bot-a')
		const second = manager.start('bot-a')
		await Promise.resolve()
		expect(create).toHaveBeenCalledTimes(1)

		resolveCreation!('session-a')
		expect(await Promise.all([first, second])).toEqual(['session-a', 'session-a'])
		expect(manager.list()).toEqual([{ id: 'bot-a', status: 'running' }])
	})

	it('enforces the maximum session limit', async () => {
		const manager = makeMultiSessionManager({ create: async id => id, maxSessions: 1 })
		await manager.start('bot-a')

		await expect(manager.start('bot-b')).rejects.toThrow('maximum session limit reached (1)')
	})

	it('waits for destroy before allowing a restart', async () => {
		const destroy = jest.fn<(session: string, id: string) => Promise<void>>().mockResolvedValue(undefined)
		const create = jest.fn(async id => `${id}-session`)
		const manager = makeMultiSessionManager({ create, destroy })

		await manager.start('bot-a')
		expect(await manager.stop('bot-a')).toBe(true)
		expect(await manager.start('bot-a')).toBe('bot-a-session')
		expect(destroy).toHaveBeenCalledWith('bot-a-session', 'bot-a')
		expect(create).toHaveBeenCalledTimes(2)
	})

	it('removes a session even when its destroyer fails', async () => {
		const manager = makeMultiSessionManager({
			create: async id => id,
			destroy: async () => {
				throw new Error('close failed')
			}
		})
		await manager.start('bot-a')

		await expect(manager.stop('bot-a')).rejects.toThrow('close failed')
		expect(manager.has('bot-a')).toBe(false)
		expect(manager.size).toBe(0)
	})

	it('reports starting and stopping states', async () => {
		let release: (() => void) | undefined
		let releaseDestroy: (() => void) | undefined
		const manager = makeMultiSessionManager({
			create: () => new Promise<string>(resolve => (release = () => resolve('session-a'))),
			destroy: () => new Promise<void>(resolve => (releaseDestroy = resolve))
		})

		const starting = manager.start('bot-a')
		expect(manager.list()).toEqual([{ id: 'bot-a', status: 'starting' }])
		await Promise.resolve()
		release!()
		await starting

		const stopping = manager.stop('bot-a')
		expect(manager.list()).toEqual([{ id: 'bot-a', status: 'stopping' }])
		releaseDestroy!()
		await stopping
		// A completed stop is removed from the status snapshot.
		expect(manager.list()).toEqual([])
	})

	it('stops all running and in-flight sessions', async () => {
		const destroyed: string[] = []
		const manager = makeMultiSessionManager({
			create: async id => id,
			destroy: async session => {
				destroyed.push(session)
			}
		})
		await Promise.all([manager.start('bot-a'), manager.start('bot-b')])

		await manager.stopAll()
		expect(destroyed.sort()).toEqual(['bot-a', 'bot-b'])
		expect(manager.size).toBe(0)
	})

	it('rejects blank ids and invalid limits', async () => {
		const manager = makeMultiSessionManager({ create: async id => id })
		await expect(manager.start('  ')).rejects.toThrow('session id must not be empty')
		expect(() => makeMultiSessionManager({ create: async id => id, maxSessions: 0 })).toThrow(
			'maxSessions must be a positive integer'
		)
	})
})
