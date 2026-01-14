/**
 * Error thrown when optimistic locking fails
 * Indicates that the entity was modified by another process
 */
export class OptimisticLockError extends Error {
	constructor(
		public readonly entityType: string,
		public readonly entityId: string,
		public readonly expectedVersion: number,
	) {
		super(
			`Optimistic lock failed for ${entityType} ${entityId}. Expected version ${expectedVersion} but entity was modified.`,
		);
		this.name = "OptimisticLockError";
	}
}
