from __future__ import annotations

import unittest

from agent.event_decoder import EventDecoderConfig, RpcEventDecoder


class FakeRpc:
    def __init__(self, logs, transactions, receipts, blocks):
        self.logs = logs
        self.transactions = transactions
        self.receipts = receipts
        self.blocks = blocks

    def get_logs(self, _filter):
        return self.logs

    def transaction(self, tx_hash):
        return self.transactions[tx_hash]

    def transaction_receipt(self, tx_hash):
        return self.receipts[tx_hash]

    def block(self, block_number):
        return self.blocks[block_number]


class EventDecoderTests(unittest.TestCase):
    def test_member_payment_decodes_to_normalized_record(self):
        tx_hash = "0x" + "11" * 32
        contract = "0x" + "22" * 20
        member = "0x" + "33" * 20
        token = "0x" + "44" * 20
        topic = "0x8b5e8e688b55a25c8ada4a46e2317b16572b97277f5d8d8b6c6d4d31da1eb690"
        pad = lambda value: "0x" + value.rjust(64, "0")
        log = {
            "address": contract,
            "topics": [topic, pad("2a"), pad(member[2:]), pad(token[2:])],
            "data": pad("01bc16d674ec80000"),
            "transactionHash": tx_hash,
            "blockNumber": "0x2",
        }
        rpc = FakeRpc(
            [log],
            {tx_hash: {"from": member, "to": contract, "gasPrice": "0x1"}},
            {tx_hash: {"status": "0x1", "gasUsed": "0x10", "effectiveGasPrice": "0x1"}},
            {2: {"timestamp": "0x64"}},
        )
        decoder = RpcEventDecoder(
            rpc,
            contract,
            EventDecoderConfig(token_symbol="DEMO", token_decimals=18),
        )
        record = decoder.decode_log(log)
        assert record is not None
        self.assertEqual(record.tx_type, "member_payment")
        self.assertEqual(record.invoice_id, "42")
        self.assertEqual(record.member_id.lower(), member.lower())
        self.assertEqual(str(record.amount), "2")
        self.assertEqual(record.block_number, 2)

    def test_unknown_topic_is_ignored(self):
        rpc = FakeRpc([], {}, {}, {})
        decoder = RpcEventDecoder(rpc, "0x" + "22" * 20)
        self.assertIsNone(decoder.decode_log({"topics": ["0x" + "00" * 32]}))


if __name__ == "__main__":
    unittest.main()
