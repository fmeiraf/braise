import { Context, Data, Effect, Exit, Layer } from "effect";
import { type Database as Client, createDatabase, migrateDatabase, type Transaction } from "./client.ts";

export class DbError extends Data.TaggedError("DbError")<{ readonly message: string; readonly cause: unknown }> {}

export class Database extends Context.Service<Database, Client>()("braise/Database") {
	static layer(connectionString: string, options: { max?: number } = {}) {
		return Layer.effect(
			Database,
			Effect.acquireRelease(
				Effect.promise(async () => {
					const opened = createDatabase(connectionString, options);

					await migrateDatabase(opened.db);

					return opened;
				}),
				(opened) => Effect.promise(() => opened.pool.end()),
			).pipe(Effect.map((opened) => opened.db)),
		);
	}
}

export class Tx extends Context.Service<Tx, Transaction>()("braise/Tx") {}

export function messageOf(cause: unknown) {
	return cause instanceof Error ? cause.message : String(cause);
}

export function query<A>(run: () => Promise<A>) {
	return Effect.tryPromise({ try: run, catch: (cause) => new DbError({ message: messageOf(cause), cause }) });
}

class Rollback extends Error {
	readonly exit: Exit.Exit<unknown, unknown>;

	constructor(exit: Exit.Exit<unknown, unknown>) {
		super("The transaction body failed");

		this.exit = exit;
	}
}

export function transaction<A, E, R>(body: Effect.Effect<A, E, R | Tx>) {
	return Effect.gen(function* () {
		const db = yield* Database;
		const context = yield* Effect.context<Exclude<R, Tx>>();

		const exit = yield* Effect.promise(() =>
			db
				.transaction(async (tx) => {
					const result = await Effect.runPromiseExit(
						body.pipe(Effect.provideService(Tx, tx), Effect.provide(context)) as Effect.Effect<A, E>,
					);

					if (Exit.isFailure(result)) throw new Rollback(result);

					return result as Exit.Exit<A, E | DbError>;
				})
				.catch((error: unknown) =>
					error instanceof Rollback
						? (error.exit as Exit.Exit<A, E | DbError>)
						: Exit.fail(new DbError({ message: messageOf(error), cause: error })),
				),
		);

		return yield* exit;
	}).pipe(Effect.uninterruptible);
}
