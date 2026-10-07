// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Demo escrow ledger for the Today Chain Not Train investigation agent.
/// Amount thresholds belong to the off-chain detector; this contract only checks
/// authorization, token balance, and record uniqueness.
contract PrepaidEscrow {
    struct Payment {
        address member;
        uint256 amount;
        bool active;
    }

    struct ServiceConfirmation {
        uint256 invoiceId;
        address member;
        uint64 confirmedAt;
    }

    IERC20Minimal public immutable token;
    address public immutable merchant;
    address public payoutAddress;
    address public pendingPayoutAddress;
    uint64 public pendingPayoutActivationTime;
    uint64 public constant PAYOUT_CHANGE_DELAY = 1 hours;

    uint256 public totalPaid;
    uint256 public totalWithdrawn;
    uint256 public totalRefunded;

    mapping(uint256 => Payment) public payments;
    mapping(uint256 => ServiceConfirmation) public services;

    event MemberPayment(
        uint256 indexed invoiceId,
        address indexed member,
        uint256 amount,
        address indexed tokenAddress
    );
    event ServiceConfirmed(
        uint256 indexed serviceId,
        uint256 indexed invoiceId,
        address indexed member,
        uint256 amount
    );
    event MerchantWithdrawal(
        address indexed merchant,
        address indexed payoutAddress,
        uint256 amount,
        uint256 observedBalanceBefore
    );
    event RefundRequested(uint256 indexed invoiceId, address indexed member, uint256 amount);
    event PayoutAddressProposed(
        address indexed oldAddress,
        address indexed newAddress,
        uint256 activationTime
    );
    event PayoutAddressActivated(address indexed oldAddress, address indexed newAddress);

    modifier onlyMerchant() {
        require(msg.sender == merchant, "only merchant");
        _;
    }

    constructor(address token_, address merchant_, address payout_) {
        require(token_ != address(0), "token is zero");
        require(merchant_ != address(0), "merchant is zero");
        require(payout_ != address(0), "payout is zero");
        token = IERC20Minimal(token_);
        merchant = merchant_;
        payoutAddress = payout_;
    }

    function escrowBalance() public view returns (uint256) {
        return token.balanceOf(address(this));
    }

    function pay(uint256 invoiceId, uint256 amount) external {
        require(amount > 0, "amount is zero");
        require(payments[invoiceId].member == address(0), "invoice exists");
        require(token.transferFrom(msg.sender, address(this), amount), "payment failed");
        payments[invoiceId] = Payment({member: msg.sender, amount: amount, active: true});
        totalPaid += amount;
        emit MemberPayment(invoiceId, msg.sender, amount, address(token));
    }

    function confirmService(
        uint256 serviceId,
        uint256 invoiceId,
        bytes calldata memberSignature
    ) external onlyMerchant {
        Payment memory payment = payments[invoiceId];
        require(payment.active, "payment inactive");
        require(services[serviceId].confirmedAt == 0, "service exists");
        require(_recover(serviceDigest(serviceId, invoiceId), memberSignature) == payment.member, "bad member signature");
        services[serviceId] = ServiceConfirmation({
            invoiceId: invoiceId,
            member: payment.member,
            confirmedAt: uint64(block.timestamp)
        });
        emit ServiceConfirmed(serviceId, invoiceId, payment.member, payment.amount);
    }

    function withdraw(uint256 amount) external onlyMerchant {
        require(amount > 0, "amount is zero");
        uint256 balanceBefore = escrowBalance();
        require(amount <= balanceBefore, "insufficient escrow balance");
        require(token.transfer(payoutAddress, amount), "withdrawal failed");
        totalWithdrawn += amount;
        emit MerchantWithdrawal(merchant, payoutAddress, amount, balanceBefore);
    }

    function requestRefund(uint256 invoiceId) external {
        Payment storage payment = payments[invoiceId];
        require(payment.member == msg.sender, "not member");
        require(payment.active, "payment inactive");
        payment.active = false;
        totalRefunded += payment.amount;
        require(token.transfer(msg.sender, payment.amount), "refund failed");
        emit RefundRequested(invoiceId, msg.sender, payment.amount);
    }

    function proposePayoutAddress(address newAddress) external onlyMerchant {
        require(newAddress != address(0), "payout is zero");
        pendingPayoutAddress = newAddress;
        pendingPayoutActivationTime = uint64(block.timestamp + PAYOUT_CHANGE_DELAY);
        emit PayoutAddressProposed(payoutAddress, newAddress, pendingPayoutActivationTime);
    }

    function activatePayoutAddress() external onlyMerchant {
        require(pendingPayoutAddress != address(0), "no pending payout");
        require(block.timestamp >= pendingPayoutActivationTime, "payout delay");
        address oldAddress = payoutAddress;
        payoutAddress = pendingPayoutAddress;
        pendingPayoutAddress = address(0);
        pendingPayoutActivationTime = 0;
        emit PayoutAddressActivated(oldAddress, payoutAddress);
    }

    function serviceDigest(uint256 serviceId, uint256 invoiceId) public view returns (bytes32) {
        return keccak256(abi.encodePacked(address(this), block.chainid, serviceId, invoiceId));
    }

    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        bytes32 prefixed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        return ecrecover(prefixed, v, r, s);
    }
}
