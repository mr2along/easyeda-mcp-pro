from easyeda_mcp.server import METHOD_HASH, NATIVE_METHODS, READ_ONLY


def test_native_method_registry_has_no_duplicates():
    assert len(NATIVE_METHODS) == 83
    assert len(set(NATIVE_METHODS)) == len(NATIVE_METHODS)


def test_native_method_hash_is_stable_sha256_prefix():
    import hashlib
    expected = hashlib.sha256(",".join(sorted(NATIVE_METHODS)).encode()).hexdigest()[:16]
    assert METHOD_HASH == expected


def test_write_methods_are_not_in_read_only_set():
    assert "pcb.modifyComponent" not in READ_ONLY
    assert "pcb.deleteComponent" not in READ_ONLY
    assert "pcb.listComponents" in READ_ONLY
    assert "design.drc" in READ_ONLY


def test_generic_runtime_execution_is_not_read_only():
    assert "api.execute" not in READ_ONLY
    assert "api.call" not in READ_ONLY
