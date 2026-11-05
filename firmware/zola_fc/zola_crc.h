// zola_crc.h — THE ONE CRC, declared once for every module
// (the reflected 0xA001 routine; the implementation lives in zola_engine.cpp
// because that's where it was born — the DECLARATION is what the modules share)
#pragma once
#include <stddef.h>
#include <stdint.h>

uint16_t calculate_zola_crc(const uint8_t* data, size_t length);
