import { createMachine, interpret } from '../src/index';
import { State } from '../src/State';
import { createSchema } from '../src/schema';

const pedestrianStates = {
  initial: 'walk',
  states: {
    walk: {
      on: {
        PED_COUNTDOWN: 'wait'
      }
    },
    wait: {
      on: {
        PED_COUNTDOWN: 'stop'
      }
    },
    stop: {}
  }
};

interface LightStateSchema {
  states: {
    green: any;
    yellow: any;
    red: any;
  };
}

type LightStateEvents =
  | {
      type: 'TIMER';
    }
  | { type: 'POWER_OUTAGE' }
  | { type: 'FORBIDDEN_EVENT' }
  | { type: 'PED_COUNTDOWN' };

const lightMachine = createMachine({
  key: 'light',
  initial: 'green',
  schema: {
    states: createSchema<LightStateSchema>(),
    events: createSchema<LightStateEvents>()
  },
  states: {
    green: {
      on: {
        TIMER: 'yellow',
        POWER_OUTAGE: 'red',
        FORBIDDEN_EVENT: undefined
      }
    },
    yellow: {
      on: {
        TIMER: 'red',
        POWER_OUTAGE: 'red'
      }
    },
    red: {
      on: {
        TIMER: 'green',
        POWER_OUTAGE: 'red'
      },
      ...pedestrianStates
    }
  }
});

const configMachine = createMachine(
  {
    id: 'config',
    initial: 'foo',
    context: {
      foo: 'bar'
    },
    schema: {
      events: createSchema<{ type: 'EVENT' }>()
    },
    states: {
      foo: {
        onEntry: 'entryAction',
        on: {
          EVENT: {
            target: 'bar',
            cond: 'someCondition'
          }
        }
      },
      bar: {}
    }
  },
  {
    actions: {
      entryAction: () => {
        throw new Error('original entry');
      }
    },
    guards: {
      someCondition: () => false
    }
  }
);

describe('machine', () => {
  describe('machine.states', () => {
    it('should properly register machine states', () => {
      expect(Object.keys(lightMachine.states)).toEqual([
        'green',
        'yellow',
        'red'
      ]);
    });
  });

  describe('machine.events', () => {
    it('should return the set of events accepted by machine', () => {
      expect(lightMachine.events).toEqual([
        'TIMER',
        'POWER_OUTAGE',
        'PED_COUNTDOWN'
      ]);
    });
  });

  describe('machine.initialState', () => {
    it('should return a State instance', () => {
      expect(lightMachine.initialState).toBeInstanceOf(State);
    });

    it('should return the initial state', () => {
      expect(lightMachine.initialState.value).toEqual('green');
    });
  });

  describe('machine.history', () => {
    it('should not retain previous history', () => {
      const next = lightMachine.transition(lightMachine.initialState, 'TIMER');
      const following = lightMachine.transition(next, 'TIMER');
      expect(following!.history!.history).not.toBeDefined();
    });
  });

  describe('machine.config', () => {
    it('state node config should reference original machine config', () => {
      const machine = createMachine({
        initial: 'one',
        states: {
          one: {
            initial: 'deep',
            states: {
              deep: {}
            }
          }
        }
      });

      const oneState = machine.getStateNodeByPath(['one']);

      expect(oneState.config).toBe(machine.config.states!.one);

      const deepState = machine.getStateNodeByPath(['one', 'deep']);

      expect(deepState.config).toBe(machine.config.states!.one.states!.deep);

      deepState.config.meta = 'testing meta';

      expect(machine.config.states!.one.states!.deep.meta).toEqual(
        'testing meta'
      );
    });
  });

  describe('machine.withConfig', () => {
    it('should override guards and actions', () => {
      const differentMachine = configMachine.withConfig({
        actions: {
          entryAction: () => {
            throw new Error('new entry');
          }
        },
        guards: { someCondition: () => true }
      });

      expect(differentMachine.context).toEqual({ foo: 'bar' });

      const service = interpret(differentMachine);

      expect(() => service.start()).toThrowErrorMatchingInlineSnapshot(
        `"new entry"`
      );

      expect(differentMachine.transition('foo', 'EVENT').value).toEqual('bar');
    });

    it('should not override context if not defined', () => {
      const differentMachine = configMachine.withConfig({});

      expect(differentMachine.initialState.context).toEqual(
        configMachine.context
      );
    });

    it('should override context (second argument)', () => {
      const differentMachine = configMachine.withConfig(
        {},
        { foo: 'different' }
      );

      expect(differentMachine.initialState.context).toEqual({
        foo: 'different'
      });
    });
  });

  describe('machine function context', () => {
    const testMachineConfig = {
      initial: 'active',
      context: () => ({
        foo: { bar: 'baz' }
      }),
      states: {
        active: {}
      }
    };

    it('context from a function should be lazily evaluated', () => {
      const testMachine1 = createMachine(testMachineConfig);
      const testMachine2 = createMachine(testMachineConfig);

      expect(testMachine1.initialState.context).not.toBe(
        testMachine2.initialState.context
      );

      expect(testMachine1.initialState.context).toEqual({
        foo: { bar: 'baz' }
      });

      expect(testMachine2.initialState.context).toEqual({
        foo: { bar: 'baz' }
      });
    });
  });

  describe('machine.resolveState()', () => {
    const resolveMachine = createMachine({
      id: 'resolve',
      initial: 'foo',
      states: {
        foo: {
          initial: 'one',
          states: {
            one: {
              type: 'parallel',
              states: {
                a: {
                  initial: 'aa',
                  states: { aa: {} }
                },
                b: {
                  initial: 'bb',
                  states: { bb: {} }
                }
              },
              on: {
                TO_TWO: 'two'
              }
            },
            two: {
              on: { TO_ONE: 'one' }
            }
          },
          on: {
            TO_BAR: 'bar'
          }
        },
        bar: {
          on: {
            TO_FOO: 'foo'
          }
        }
      }
    });

    it('should resolve the state value', () => {
      const tempState = State.from<any>('foo');

      const resolvedState = resolveMachine.resolveState(tempState);

      expect(resolvedState.value).toEqual({
        foo: { one: { a: 'aa', b: 'bb' } }
      });
    });

    it('should resolve the state configuration (implicit via events)', () => {
      const tempState = State.from<any>('foo');

      const resolvedState = resolveMachine.resolveState(tempState);

      expect(resolvedState.nextEvents.sort()).toEqual(['TO_BAR', 'TO_TWO']);
    });
  });

  describe('versioning', () => {
    it('should allow a version to be specified', () => {
      const versionMachine = createMachine({
        id: 'version',
        version: '1.0.4',
        states: {}
      });

      expect(versionMachine.version).toEqual('1.0.4');
    });

    it('should show the version on state nodes', () => {
      const versionMachine = createMachine({
        id: 'version',
        version: '1.0.4',
        states: {
          foo: {
            id: 'foo'
          }
        }
      });

      const fooStateNode = versionMachine.getStateNodeById('foo');

      expect(fooStateNode.version).toEqual('1.0.4');
    });
  });

  describe('id', () => {
    it('should represent the ID', () => {
      const idMachine = createMachine({
        id: 'some-id',
        initial: 'idle',
        states: { idle: {} }
      });

      expect(idMachine.id).toEqual('some-id');
    });

    it('should represent the ID (state node)', () => {
      const idMachine = createMachine({
        id: 'some-id',
        initial: 'idle',
        states: {
          idle: {
            id: 'idle'
          }
        }
      });

      expect(idMachine.getStateNode('idle').id).toEqual('idle');
    });

    it('should use the key as the ID if no ID is provided', () => {
      const noIDMachine = createMachine({
        key: 'some-key',
        initial: 'idle',
        states: { idle: {} }
      });

      expect(noIDMachine.id).toEqual('some-key');
    });

    it('should use the key as the ID if no ID is provided (state node)', () => {
      const noStateNodeIDMachine = createMachine({
        id: 'some-id',
        initial: 'idle',
        states: { idle: {} }
      });

      expect(noStateNodeIDMachine.getStateNode('idle').id).toEqual(
        'some-id.idle'
      );
    });
  });
});

describe('StateNode', () => {
  it('should list transitions', () => {
    const greenNode = lightMachine.states.green;

    const transitions = greenNode.transitions;

    expect(transitions.map((t) => t.eventType)).toEqual([
      'TIMER',
      'POWER_OUTAGE',
      'FORBIDDEN_EVENT'
    ]);
  });
});
