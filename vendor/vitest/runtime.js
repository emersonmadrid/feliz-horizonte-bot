const tests = [];
const suiteStack = [];

function buildName(name) {
  return [...suiteStack, name].join(" > ");
}

export function describe(name, fn) {
  suiteStack.push(name);
  try {
    fn();
  } finally {
    suiteStack.pop();
  }
}

export function it(name, fn) {
  tests.push({ name: buildName(name), fn });
}

export const test = it;

export function expect(received) {
  return {
    toBe(expected) {
      if (!Object.is(received, expected)) {
        throw new Error(`Esperado ${expected} pero se obtuvo ${received}`);
      }
    },
    toContain(expected) {
      if (!(received ?? "").toString().includes(expected)) {
        throw new Error(`Se esperaba que ${received} contenga ${expected}`);
      }
    }
  };
}

export async function runRegisteredTests() {
  let failed = 0;

  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`✗ ${name}`);
      console.error(err?.message || err);
    }
  }

  return { total: tests.length, failed, passed: tests.length - failed };
}

export function resetTests() {
  tests.splice(0, tests.length);
}
