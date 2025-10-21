import {
	type Context,
	createContext,
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
} from "react";

export type StatePublisherListener<Value> = (
	value: Value,
	previousValue: Value,
) => void;

export type StatePublisherContext<Value> = {
	stateRef: RefObject<Value>;
	stateListenersRef: RefObject<Map<number, StatePublisherListener<Value>>>;
	publish: (value: Value) => void;
	subscribe: (callback: StatePublisherListener<Value>) => () => void;
	reset: () => void;
};

export type StatePublisher<Value> = {
	defaultValue: Value;
	ignoreUndefined: boolean;
	context: Context<StatePublisherContext<Value>>;
};

export function createPublisher<Value>(
	defaultValue: Value,
	ignoreUndefined = false,
): StatePublisher<Value> {
	const context = createContext<StatePublisherContext<Value>>({
		stateRef: { current: defaultValue },
		stateListenersRef: { current: new Map() },
		publish: () => {},
		subscribe: () => () => {},
		reset: () => {},
	});

	return { defaultValue, ignoreUndefined, context };
}

export function PublisherProvider<Value>({
	children,
	statePublisher,
}: {
	children: React.ReactNode;
	statePublisher: StatePublisher<Value>;
}) {
	const {
		defaultValue,
		ignoreUndefined,
		context: StatePublisherContext,
	} = statePublisher;
	const stateRef = useRef(defaultValue);
	const stateListenersRef = useRef<Map<number, StatePublisherListener<Value>>>(
		new Map(),
	);
	const listenerIdRef = useRef<number>(0);

	const publish = useCallback(
		(value: Value) => {
			const previousValue = stateRef.current;
			stateRef.current = value;

			if (ignoreUndefined && value === undefined) {
				return;
			}

			stateListenersRef.current.forEach((listener) => {
				listener(value, previousValue);

				return;
			});
		},
		[ignoreUndefined],
	);

	const subscribe = useCallback((listener: StatePublisherListener<Value>) => {
		const listenerId = listenerIdRef.current++;
		stateListenersRef.current.set(listenerId, listener);

		return () => {
			stateListenersRef.current.delete(listenerId);
		};
	}, []);

	const reset = useCallback(() => {
		publish(defaultValue);
	}, [defaultValue, publish]);

	const publisherValue = useMemo(
		() => ({
			stateRef,
			stateListenersRef,
			publish,
			subscribe,
			reset,
		}),
		[publish, subscribe, reset],
	);

	useEffect(() => {
		return () => {
			stateRef.current = defaultValue;
			stateListenersRef.current.clear();
			listenerIdRef.current = 0;
		};
	}, [defaultValue]);

	return (
		<StatePublisherContext.Provider value={publisherValue}>
			{children}
		</StatePublisherContext.Provider>
	);
}

function createNestedProviders<Value>(
	statePublishers: StatePublisher<Value>[],
	children: React.ReactNode,
	index: number,
): React.ReactNode {
	if (index >= statePublishers.length) {
		return children;
	}

	return (
		<PublisherProvider statePublisher={statePublishers[index]}>
			{createNestedProviders(statePublishers, children, index + 1)}
		</PublisherProvider>
	);
}

export function withStatePublisher<Props extends object>(
	Component: React.ComponentType<Props>,
	// biome-ignore lint/suspicious/noExplicitAny: 动态类型
	...statePublishers: StatePublisher<any>[]
) {
	return function WithStatePublisher(props: Props) {
		return createNestedProviders(statePublishers, <Component {...props} />, 0);
	};
}
