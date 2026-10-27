"""Compatibility entry point for the external live harness."""
import runpy

runpy.run_module("tests.integration.live_fault_worker", run_name="__main__")
