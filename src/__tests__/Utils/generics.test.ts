import type { BaileysEventEmitter, BaileysEventMap } from '../../Types'
import { bindWaitForEvent, BufferJSON } from '../../Utils/generics'

const makeEventEmitter = (): BaileysEventEmitter => {
	const listeners = new Map<keyof BaileysEventMap, Set<(value: never) => void>>()
	return {
		on: (event, listener) => {
			const entries = listeners.get(event) || new Set<(value: never) => void>()
			entries.add(listener as (value: never) => void)
			listeners.set(event, entries)
		},
		off: (event, listener) => {
			listeners.get(event)?.delete(listener as (value: never) => void)
		},
		removeAllListeners: event => listeners.delete(event),
		emit: (event, value) => {
			for (const listener of listeners.get(event) || []) listener(value as never)
			return true
		}
	}
}

describe('BufferJSON', () => {
	const originalObject = {
		id: 1,
		key: Buffer.from([1, 2, 3, 4, 5]),
		nested: {
			data: Buffer.from([6, 7, 8])
		}
	}

	const legacyJsonString = '{"id":1,"key":{"0":1,"1":2,"2":3,"3":4,"4":5},"nested":{"data":{"0":6,"1":7,"2":8}}}'

	it('should correctly perform a round trip (stringify with replacer, parse with reviver)', () => {
		const serialized = JSON.stringify(originalObject, BufferJSON.replacer)

		expect(serialized).toContain('"type":"Buffer"')
		expect(serialized).not.toContain('"data":[1,2,3,4,5]')

		const revived = JSON.parse(serialized, BufferJSON.reviver)

		expect(Buffer.isBuffer(revived.key)).toBe(true)
		expect(Buffer.isBuffer(revived.nested.data)).toBe(true)
		expect(revived.key).toEqual(originalObject.key)
		expect(revived).toEqual(originalObject)
	})

	it('should correctly revive a legacy JSON string with object-like buffers', () => {
		const revived = JSON.parse(legacyJsonString, BufferJSON.reviver)

		expect(Buffer.isBuffer(revived.key)).toBe(true)
		expect(Buffer.isBuffer(revived.nested.data)).toBe(true)
		expect(revived.key).toEqual(originalObject.key)
		expect(revived.nested.data).toEqual(originalObject.nested.data)
		expect(revived.id).toEqual(originalObject.id)
	})

	it('should not corrupt legitimate objects that are not buffers', () => {
		const legitimateProtoObject = {
			'0': 'some-value',
			'1': 'another-value'
		}
		const jsonString = JSON.stringify(legitimateProtoObject)
		const revived = JSON.parse(jsonString, BufferJSON.reviver)

		expect(Buffer.isBuffer(revived)).toBe(false)
		expect(revived).toEqual(legitimateProtoObject)
	})

	it('should not convert other objects or null values', () => {
		const otherObject = {
			a: 1,
			b: 2,
			c: null,
			d: { '0': 1, foo: 'bar' }
		}
		const jsonString = JSON.stringify(otherObject)
		const revived = JSON.parse(jsonString, BufferJSON.reviver)

		expect(Buffer.isBuffer(revived.a)).toBe(false)
		expect(revived.c).toBeNull()
		expect(Buffer.isBuffer(revived.d)).toBe(false)
		expect(revived).toEqual(otherObject)
	})

	it('should correctly handle an empty object', () => {
		const revived = JSON.parse('{}', BufferJSON.reviver)
		expect(revived).toEqual({})
	})
})

describe('bindWaitForEvent', () => {
	it('should reject and clean up when the async predicate throws', async () => {
		const ev = makeEventEmitter()
		const wait = bindWaitForEvent(ev, 'connection.update')
		const error = new Error('predicate failed')
		const pending = wait(async () => {
			throw error
		}, 1000)

		ev.emit('connection.update', { connection: 'open' })
		await expect(pending).rejects.toBe(error)

		// A second event must not invoke the completed waiter again.
		ev.emit('connection.update', { connection: 'open' })
	})
})
