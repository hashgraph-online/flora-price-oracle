import { startPetal } from "../src/petal.js";
import "dotenv/config";
import { startConsumer } from "../src/consumer.js";
import { MockAdapter } from "../src/adapters/mock.js";
import { ensureTopic } from "../src/lib/hedera.js";
import type { AdapterDeclaration } from "../src/adapters/declarations.js";

const main = async (): Promise<void> => {
  const topicIdString = await ensureTopic(process.env.STATE_TOPIC_ID, "hcs-17:0:86400");
  const consumer = startConsumer({
    port: 3100,
    quorum: 2,
    expectedPetals: 2,
    stateTopicId: topicIdString,
    mirrorBaseUrl: process.env.MIRROR_BASE_URL,
  });

  const mockDeclarations: AdapterDeclaration[] = [
    {
      p: "hcs-21",
      op: "register",
      adapter_id: "mock-a",
      entity: "HBAR-USD",
      package: { registry: "demo", name: "mock-a", version: "1.0.0", integrity: "sha384-mock" },
      manifest: "hcs://1/0.0.0",
      config: {
        type: "flora",
        account: "0.0.mock",
        threshold: "demo-threshold",
        ctopic: "0.0.0",
        ttopic: "0.0.0",
        stopic: topicIdString,
      },
      state_model: "hcs17:sha384",
    },
    {
      p: "hcs-21",
      op: "register",
      adapter_id: "mock-b",
      entity: "HBAR-USD",
      package: { registry: "demo", name: "mock-b", version: "1.0.0", integrity: "sha384-mock" },
      manifest: "hcs://1/0.0.0",
      config: {
        type: "flora",
        account: "0.0.mock",
        threshold: "demo-threshold",
        ctopic: "0.0.0",
        ttopic: "0.0.0",
        stopic: topicIdString,
      },
      state_model: "hcs17:sha384",
    },
  ];
  const adapters = [new MockAdapter("mock-a", 0.0705), new MockAdapter("mock-b", 0.071)];

  const petalA = await startPetal({
    petalId: "petal-a",
    participants: ["petal-a", "petal-b"],
    stateTopicId: TopicId.fromString(topicIdString),
    adapterDeclarations: mockDeclarations,
    adapters,
  });
  const petalB = await startPetal({
    petalId: "petal-b",
    participants: ["petal-a", "petal-b"],
    stateTopicId: TopicId.fromString(topicIdString),
    adapterDeclarations: mockDeclarations,
    adapters,
  });

  const consensus = await consumer.waitForConsensus(40_000);

  petalA.stop();
  petalB.stop();
  consumer.stop();

  if (!consensus) {
    throw new Error("No consensus reached in smoke test");
  }

  // eslint-disable-next-line no-console
  console.log("Smoke test consensus price", consensus.price);
  process.exit(0);
};

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
