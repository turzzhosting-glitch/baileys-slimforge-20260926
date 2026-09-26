export type SessionFactory<Session> = (id: string) => Session | Promise<Session>
export type SessionDestroyer<Session> = (session: Session, id: string) => void | Promise<void>

export type MultiSessionManagerOptions<Session> = {
	create: SessionFactory<Session>
	destroy?: SessionDestroyer<Session>
	maxSessions?: number
}

export type SessionStatus = 'starting' | 'running' | 'stopping'

export type SessionInfo = {
	id: string
	status: SessionStatus
}

const validateId = (id: string) => {
	if (!id.trim()) {
		throw new Error('session id must not be empty')
	}
}

/**
 * Coordinates multiple independently-owned bot sessions in one process.
 *
 * The manager deliberately does not create sockets itself. This keeps auth,
 * logging, and storage under the caller's control while making lifecycle races
 * deterministic for multi-bot applications.
 */
export class MultiSessionManager<Session> {
	private readonly sessions = new Map<string, Session>()
	private readonly starts = new Map<string, Promise<Session>>()
	private readonly stops = new Map<string, Promise<boolean>>()
	private readonly create: SessionFactory<Session>
	private readonly destroy?: SessionDestroyer<Session>
	private readonly maxSessions: number

	constructor(options: MultiSessionManagerOptions<Session>) {
		if (!Number.isInteger(options.maxSessions) || (options.maxSessions ?? 1) < 1) {
			if (options.maxSessions !== undefined) {
				throw new Error('maxSessions must be a positive integer')
			}
		}

		this.create = options.create
		this.destroy = options.destroy
		this.maxSessions = options.maxSessions ?? Infinity
	}

	/** Starts a session, or returns the same in-flight promise for duplicate calls. */
	async start(id: string): Promise<Session> {
		validateId(id)

		const running = this.sessions.get(id)
		if (running !== undefined) return running

		const stopping = this.stops.get(id)
		if (stopping) {
			await stopping
			return this.start(id)
		}

		const pending = this.starts.get(id)
		if (pending) return pending

		if (this.activeCount() >= this.maxSessions) {
			throw new Error(`maximum session limit reached (${this.maxSessions})`)
		}

		const creation = Promise.resolve()
			.then(() => this.create(id))
			.then(session => {
				this.sessions.set(id, session)
				return session
			})
			.finally(() => {
				this.starts.delete(id)
			})

		this.starts.set(id, creation)
		return creation
	}

	/** Stops a session and waits for its destroyer before allowing a restart. */
	async stop(id: string): Promise<boolean> {
		validateId(id)

		const existing = this.stops.get(id)
		if (existing) return existing

		const stopping = (async () => {
			const pending = this.starts.get(id)
			if (pending) {
				await pending.catch(() => undefined)
			}

			const session = this.sessions.get(id)
			if (session === undefined) return false

			try {
				await this.destroy?.(session, id)
			} finally {
				this.sessions.delete(id)
			}

			return true
		})()

		this.stops.set(id, stopping)
		stopping.finally(() => this.stops.delete(id)).catch(() => undefined)
		return stopping
	}

	/** Stops every known session and waits for all destroyers to settle. */
	async stopAll(): Promise<void> {
		const ids = new Set([...this.sessions.keys(), ...this.starts.keys()])
		await Promise.all([...ids].map(id => this.stop(id)))
	}

	get(id: string): Session | undefined {
		return this.sessions.get(id)
	}

	has(id: string): boolean {
		return this.sessions.has(id)
	}

	get size(): number {
		return this.sessions.size
	}

	/** Returns a stable snapshot suitable for health endpoints and metrics. */
	list(): SessionInfo[] {
		const statuses = new Map<string, SessionStatus>()
		for (const id of this.sessions.keys()) statuses.set(id, 'running')
		for (const id of this.starts.keys()) statuses.set(id, 'starting')
		for (const id of this.stops.keys()) statuses.set(id, 'stopping')
		return [...statuses].map(([id, status]) => ({ id, status }))
	}

	private activeCount(): number {
		return this.sessions.size + this.starts.size + this.stops.size
	}
}
export const makeMultiSessionManager = <Session>(options: MultiSessionManagerOptions<Session>) =>
	new MultiSessionManager(options)
