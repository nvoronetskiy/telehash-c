#include <string.h>
#include <stdio.h>
#include <ctype.h>

#include "platform.h"
#include "uri.h"

// these all allocate/free memory
uri_t uri_new(char *encoded, char *protocol)
{
  uri_t uri;
  uint32_t plen, ulen, alen, klen;
  char *at, *user, *address;

  if(!encoded) return LOG("bad args");

  // check for protocol:// prefix first
  if(!(at = strstr(encoded,"://")))
  {
    if(!protocol) return LOG("no protocol found or given");
    plen = strlen(protocol);
  }else{
    plen = at - encoded;
    // enforce if specified
    if(protocol && (plen != strlen(protocol) || strncmp(encoded,protocol,plen))) return LOG("protocol mismatch %s != %.*s",protocol,plen,encoded);
    protocol = encoded;
    encoded = at+3;
  }
  
  // check for user@ prefix next
  if((at = strchr(encoded,'@')))
  {
    ulen = at - encoded;
    user = encoded;
    if(!ulen || !islower(user[0])) return LOG("invalid user: '%.*s'",ulen,user);
    // TODO decode optional .base32 alternative
    encoded = at+1;
  }else{
    ulen = 0;
  }
  
  address = encoded;
  alen = strlen(address);

  // ensure there's at least an address
  if(!alen || !isalnum(address[0])) return LOG("invalid address: '%s'",address);

  if(!(uri = malloc(sizeof(struct uri_struct)))) return LOG("OOM");
  memset(uri,0,sizeof (struct uri_struct));

  uri->protocol = strdup(protocol);
  if(ulen) uri->user = strndup(user,ulen);

  // copy in canonical and parse address/port
  if((at = strchr(encoded,'/')) || (at = strchr(encoded,'?')) || (at = strchr(encoded,'#')))
  {
    uri->canonical = strndup(encoded, at - encoded);
  }else{
    uri->canonical = strdup(encoded);
  }
  uri_canonical(uri,NULL);

  // optional session
  if((at = strchr(encoded,'/')))
  {
    encoded = at+1;
    if((at = strchr(encoded,'?')) || (at = strchr(encoded,'#')))
    {
      uri->session = strndup(encoded, at - encoded);
    }else{
      uri->session = strdup(encoded);
    }
  }

  // optional keys
  if((at = strchr(encoded,'?')))
  {
    encoded = at+1;
    if((at = strchr(encoded,'#')))
    {
      klen = at - encoded;
    }else{
      klen = strlen(encoded);
    }
    // TODO decode keys in querystring
  }

  // optional token
  if((at = strchr(encoded,'#')))
  {
    encoded = at+1;
    uri->token = strdup(encoded);
  }

  return uri;
}

uri_t uri_free(uri_t uri)
{
  if(!uri) return NULL;
  free(uri->protocol);
  free(uri->canonical);
  free(uri->address);
  if(uri->user) free(uri->user);
  if(uri->session) free(uri->session);
  if(uri->token) free(uri->token);
  lob_free(uri->keys);
  free(uri);
  return NULL;
}

// produces string safe to use until next encode or free
char *uri_encode(uri_t uri)
{
  uint32_t len;
  if(!uri) return LOG("bad args");
  if(uri->encoded) free(uri->encoded);
  len = 9; // space for seperator chars of '://@:/?#\0'
  len += strlen(uri->protocol);
  len += uri->user?strlen(uri->user):0;
  len += strlen(uri->address);
  len += 11;
  len += uri->session?strlen(uri->session):0;
  len += uri->token?strlen(uri->token):0;
  if(!(uri->encoded = malloc(len))) return LOG("OOM %d",len);

  sprintf(uri->encoded,"%s://",uri->protocol);
  if(uri->user) sprintf(uri->encoded+strlen(uri->encoded),"%s@",uri->user);
  sprintf(uri->encoded+strlen(uri->encoded),"%s",uri->address);
  if(uri->port) sprintf(uri->encoded+strlen(uri->encoded),":%u",uri->port);
  if(uri->session) sprintf(uri->encoded+strlen(uri->encoded),"/%s",uri->session);
  if(uri->keys)
  {
    sprintf(uri->encoded+strlen(uri->encoded),"?TODO");
  }
  if(uri->token) sprintf(uri->encoded+strlen(uri->encoded),"#%s",uri->token);
  return uri->encoded;
}

uri_t uri_protocol(uri_t uri, char *protocol)
{
  if(!uri || !protocol) return LOG("bad args");
  if(uri->protocol) free(uri->protocol);
  uri->protocol = strdup(protocol);
  return uri;
}

uri_t uri_user(uri_t uri, char *user)
{
  if(!uri) return LOG("bad args");
  if(uri->user) free(uri->user);
  uri->user = user?strdup(user):NULL;
  return uri;
}

uri_t uri_canonical(uri_t uri, char *canonical)
{
  char *at;
  if(!uri) return LOG("bad args");
  if(canonical)
  {
    if(uri->canonical) free(uri->canonical);
    uri->canonical = strdup(canonical);
  }

  if(uri->address) free(uri->address);
  
  if((at = strchr(uri->canonical,':')))
  {
    uri->address = strndup(uri->canonical, at - uri->canonical);
    uri->port = strtol(at+1,NULL,10);
  }else{
    uri->address = strdup(uri->canonical);
    uri->port = 0;
  }

  return uri;
}

uri_t uri_address(uri_t uri, char *address)
{
  if(!uri || !address) return LOG("bad args");
  if(uri->address) free(uri->address);
  uri->address = strdup(address);
  return uri;
}

uri_t uri_port(uri_t uri, uint32_t port)
{
  if(!uri) return LOG("bad args");
  uri->port = port;
  return uri;
}

uri_t uri_session(uri_t uri, char *session)
{
  if(!uri) return LOG("bad args");
  if(uri->session) free(uri->session);
  uri->session = session?strdup(session):NULL;
  return uri;
}

uri_t uri_keys(uri_t uri, lob_t keys)
{
  if(!uri || !keys) return LOG("bad args");
  if(uri->keys) lob_free(uri->keys);
  uri->keys = lob_copy(keys);
  return uri;
}

uri_t uri_token(uri_t uri, char *token)
{
  if(!uri) return LOG("bad args");
  if(uri->token) free(uri->token);
  uri->token = token?strdup(token):NULL;
  return uri;
}

