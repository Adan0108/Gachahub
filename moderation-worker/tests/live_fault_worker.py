"""Compatibility entry point for the external live harness."""
import runpy

if __name__ == "__main__":
    runpy.run_module("tests.integration.live_fault_worker", run_name="__main__")
