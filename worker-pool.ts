/**
 * A generic Worker Pool to manage parallel execution of background tasks.
 *
 * This pool maintains a fixed set of persistent Worker threads. Tasks are
 * queued and dispatched to idle workers as they become available. This
 * approach minimizes the overhead of creating and destroying threads during
 * high-frequency operations like HMM ensemble training.
 */
export class WorkerPool {
    private workers: Worker[] = [];
    private idleWorkers: Worker[] = [];
    private queue: { task: any; resolve: (val: any) => void }[] = [];

    /**
     * Initializes the pool with a fixed number of workers.
     *
     * @param size - Number of workers to spawn.
     * @param scriptPath - Absolute or relative path to the worker script file.
     */
    constructor(size: number, scriptPath: string) {
        for (let i = 0; i < size; i++) {
            // Using Bun's Worker implementation
            const worker = new Worker(new URL(scriptPath, import.meta.url).href);
            worker.onmessage = (e) => this.handleMessage(worker, e.data);
            this.workers.push(worker);
            this.idleWorkers.push(worker);
        }
    }

    /**
     * Internal handler for messages received from a worker.
     * Completes the pending promise and attempts to process the next task in the queue.
     */
    private handleMessage(worker: Worker, data: any) {
        const currentTask = (worker as any).currentTask;
        if (currentTask) {
            const { resolve } = currentTask;
            (worker as any).currentTask = null;
            this.idleWorkers.push(worker);
            // Resolve the promise with the computed result from the worker
            resolve(data.results);
            // After becoming idle, check if there's work waiting in the queue
            this.processQueue();
        }
    }

    /**
     * Dispatches the first task in the queue to the first available idle worker.
     */
    private processQueue() {
        if (this.queue.length > 0 && this.idleWorkers.length > 0) {
            const worker = this.idleWorkers.pop()!;
            const { task, resolve } = this.queue.shift()!;
            (worker as any).currentTask = { resolve };
            worker.postMessage(task);
        }
    }

    /**
     * Submits a task for execution in the pool.
     *
     * @param task - The data/payload to send to the worker.
     * @returns A promise that resolves when the worker completes the task.
     */
    async run(task: any): Promise<any> {
        return new Promise((resolve) => {
            this.queue.push({ task, resolve });
            this.processQueue();
        });
    }

    /**
     * Forcibly terminates all worker threads in the pool.
     * Should be called when the pool is no longer needed (e.g., at the end of a backtest).
     */
    terminate() {
        for (const w of this.workers) w.terminate();
    }
}
